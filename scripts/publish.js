/**
 * 오피스 헬스랩 — 카드뉴스 자동 게시 (GitHub Actions 전용)
 *
 * 흐름: Notion(승인+게시시각 도래) → Playwright 렌더 → 레포 커밋(공개 URL) → Instagram 캐러셀 게시 → Notion 갱신
 * 필요한 Secret: NOTION_TOKEN, IG_USER_ID, IG_TOKEN
 * 환경변수: GITHUB_REPOSITORY(자동), DRY_RUN=1 이면 게시 없이 렌더까지만
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const IG_USER_ID = process.env.IG_USER_ID;
const IG_TOKEN = process.env.IG_TOKEN;
const DB_ID = process.env.NOTION_DB_ID || 'bf9e0568-4a66-4ad4-a58c-1619d6ca1a1e';
const REPO = process.env.GITHUB_REPOSITORY;          // "user/repo"
const BRANCH = process.env.GITHUB_REF_NAME || 'main';
const DRY = process.env.DRY_RUN === '1';

const BRAND = '오피스 헬스랩';
const HANDLE = '@office_healthlab';
const GRAPH = 'https://graph.facebook.com/v21.0';

const log = (...a) => console.log(...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Notion 헬퍼 ──────────────────────────────────────────────
async function notion(pathname, method = 'GET', body) {
  const res = await fetch('https://api.notion.com/v1' + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Notion ${method} ${pathname} → ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

const plain = p => (p?.rich_text || p?.title || []).map(t => t.plain_text).join('');

// ─── Instagram 헬퍼 ───────────────────────────────────────────
async function ig(pathname, params) {
  const body = new URLSearchParams({ ...params, access_token: IG_TOKEN });
  const res = await fetch(`${GRAPH}${pathname}`, { method: 'POST', body });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Instagram ${pathname} → ${JSON.stringify(json.error || json).slice(0, 400)}`);
  }
  return json;
}

// ─── 렌더링 ───────────────────────────────────────────────────
async function renderCards(item, outDir) {
  fs.mkdirSync(outDir, { recursive: true });

  const [head, emph] = item.title.split('/').map(s => s.trim());
  const cards = [];
  const total = item.slides.length + 2;

  cards.push({
    mode: 'cover', brand: BRAND, handle: HANDLE, badge: item.badge, total,
    title: emph ? `${head}\n**${emph}**` : `**${head}**`,
    sub: item.sub,
  });
  item.slides.forEach((s, i) => cards.push({
    mode: 'body', brand: BRAND, handle: HANDLE, label: 'TIP', total,
    no: i + 1, head: s.head, body: s.body, idx: i + 2,
  }));
  cards.push({
    mode: 'end', brand: BRAND, handle: HANDLE, total,
    title: '도움이 됐다면\n**저장**해 주세요',
    sub: '매일 아침 8시\n1분 건강 습관이 올라옵니다',
  });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  await page.goto('file://' + path.resolve(__dirname, '..', 'templates', 'card.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200); // 웹폰트 로드 여유

  const files = [];
  for (let i = 0; i < cards.length; i++) {
    await page.evaluate(c => renderCard(c), cards[i]);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);
    const name = `card_${String(i + 1).padStart(2, '0')}.jpg`;
    await page.screenshot({ path: path.join(outDir, name), type: 'jpeg', quality: 92 });
    files.push(name);
    log('   렌더 ✓', name);
  }
  await browser.close();
  return files;
}

// ─── 메인 ─────────────────────────────────────────────────────
(async () => {
  for (const [k, v] of Object.entries({ NOTION_TOKEN, IG_USER_ID, IG_TOKEN })) {
    if (!v && !(DRY && k !== 'NOTION_TOKEN')) throw new Error(`Secret 누락: ${k}`);
  }

  const nowIso = new Date().toISOString();
  log('▶ 게시 대상 조회 …', nowIso);

  const q = await notion(`/databases/${DB_ID}/query`, 'POST', {
    filter: {
      and: [
        { property: '상태', select: { equals: '승인' } },
        { property: '유형', select: { equals: '카드뉴스' } },
        { property: '게시일시', date: { on_or_before: nowIso } },
      ],
    },
    sorts: [{ property: '게시일시', direction: 'ascending' }],
    page_size: 3,
  });

  if (!q.results.length) { log('대상 없음 — 종료'); return; }
  log(`대상 ${q.results.length}건`);

  for (const page of q.results) {
    const P = page.properties;
    const item = {
      id: page.id,
      title: plain(P['제목']),
      badge: plain(P['카테고리']),
      sub: plain(P['부제']),
      caption: plain(P['캡션']),
      tags: plain(P['해시태그']),
      slides: plain(P['슬라이드 문구'])
        .split('\n').map(l => l.trim()).filter(Boolean)
        .map(l => { const [h, ...b] = l.split('::'); return { head: h.trim(), body: b.join('::').trim() }; }),
    };
    log(`\n─── ${item.title} (슬라이드 ${item.slides.length})`);

    try {
      if (item.slides.length < 1) throw new Error('슬라이드 문구가 비어 있습니다');

      // 1) 렌더
      const slug = `${nowIso.slice(0, 10)}-${page.id.slice(0, 8)}`;
      const outDir = path.join('cards', slug);
      const files = await renderCards(item, outDir);

      // 2) 커밋 → 공개 URL 확보
      const urls = files.map(f => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${outDir}/${f}`);
      execSync('git config user.name "OfficeHealthLab Bot" && git config user.email "bot@users.noreply.github.com"');
      execSync(`git add ${outDir} && git commit -q -m "cards: ${slug} (${files.length})" && git push -q`, { stdio: 'inherit' });
      log('   커밋·푸시 ✓');
      await sleep(4000); // raw CDN 반영 대기

      if (DRY) { log('   DRY_RUN — 게시 생략\n' + urls.join('\n')); continue; }

      // 3) 인스타그램 캐러셀
      const children = [];
      for (const url of urls) {
        const r = await ig(`/${IG_USER_ID}/media`, { image_url: url, is_carousel_item: 'true' });
        children.push(r.id);
      }
      log('   컨테이너 ✓', children.length);

      const caption = [item.caption, '', item.tags].join('\n');
      const parent = await ig(`/${IG_USER_ID}/media`, {
        media_type: 'CAROUSEL', children: children.join(','), caption,
      });
      await sleep(3000);
      const pub = await ig(`/${IG_USER_ID}/media_publish`, { creation_id: parent.id });
      log('   게시 완료 ✓', pub.id);

      // 4) 게시물 링크 조회 + Notion 갱신
      let link = '';
      try {
        const p = await (await fetch(`${GRAPH}/${pub.id}?fields=permalink&access_token=${IG_TOKEN}`)).json();
        link = p.permalink || '';
      } catch {}

      await notion(`/pages/${page.id}`, 'PATCH', {
        properties: {
          '상태': { select: { name: '게시됨' } },
          '이미지 URL 목록': { rich_text: [{ text: { content: urls.join('\n').slice(0, 1900) } }] },
          ...(link ? { '게시물 링크': { url: link } } : {}),
        },
      });
      log('   Notion 갱신 ✓', link);

    } catch (e) {
      console.error('   ✗ 실패:', e.message);
      try {
        await notion(`/pages/${page.id}`, 'PATCH', {
          properties: {
            '상태': { select: { name: '실패' } },
            '오류 메모': { rich_text: [{ text: { content: String(e.message).slice(0, 1900) } }] },
          },
        });
      } catch {}
      process.exitCode = 1;
    }
  }
})();

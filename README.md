# 오피스 헬스랩 — 카드뉴스 자동 게시

Notion 콘텐츠 캘린더에서 **상태 = 승인**이고 게시 시각이 지난 카드뉴스를 찾아,
카드 이미지를 렌더링하고 이 저장소에 커밋한 뒤, 인스타그램에 캐러셀로 게시합니다.
GitHub Actions에서 전부 무료로 돌아갑니다. (공개 저장소는 Actions 사용량 무제한)

```
Notion(승인)  →  Playwright 렌더  →  레포 커밋(공개 URL)  →  Instagram 게시  →  Notion 갱신
```

## 구성

| 경로 | 역할 |
|---|---|
| `.github/workflows/publish.yml` | 한국시간 07:30~09:45 15분 간격 자동 실행 + 수동 실행 버튼 |
| `scripts/publish.js` | 조회 → 렌더 → 커밋 → 게시 → 상태 갱신 전 과정 |
| `templates/card.html` | 카드 디자인 (Ink & Coral) |
| `cards/` | 렌더 결과가 쌓이는 곳 (게시 이미지의 실제 호스팅 위치) |

## 설정해야 하는 Secret 3개

저장소 → Settings → Secrets and variables → Actions → New repository secret

| 이름 | 값 |
|---|---|
| `NOTION_TOKEN` | Notion 내부 통합 시크릿 (`ntn_`로 시작) |
| `IG_USER_ID` | `17841443200285485` |
| `IG_TOKEN` | 페이스북 페이지 액세스 토큰 (장기) |

### NOTION_TOKEN 만들기
1. https://www.notion.so/my-integrations → **New integration**
2. 이름 `office-healthlab-bot`, 워크스페이스 선택 → 저장 → **Internal Integration Secret** 복사
3. Notion에서 **콘텐츠 캘린더** 데이터베이스 열기 → 우측 상단 `⋯` → **연결 추가** → 방금 만든 통합 선택
   (이 단계를 빠뜨리면 권한 오류가 납니다)

### IG_TOKEN 만들기
1. https://developers.facebook.com/tools/explorer/
2. 앱 선택 → 권한에 `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement` 추가 → Generate Access Token
3. https://developers.facebook.com/tools/debug/accesstoken/ 에 붙여넣고 **Extend Access Token** (60일 장기 토큰)
4. 장기 사용자 토큰으로 `GET /me/accounts` 호출 → **오피스 헬스랩** 페이지의 `access_token` 값 사용
   (장기 사용자 토큰에서 뽑은 페이지 토큰은 만료되지 않습니다)

## 동작 확인
Actions 탭 → **카드뉴스 자동 게시** → **Run workflow** → `dry_run` 체크 → 실행
렌더링과 커밋만 수행하고 게시는 건너뜁니다. `cards/` 폴더에 이미지가 생기면 정상입니다.

## 즉시 게시
Actions 탭 → **Run workflow** (dry_run 해제). 폰에서도 됩니다.

## Notion 속성 형식
- **제목**: `앞부분 / 강조부분` — `/` 기준으로 두 줄, 뒷부분이 코랄색 강조
- **슬라이드 문구**: 한 줄에 슬라이드 하나, `소제목 :: 본문`
- **카테고리**: 표지 상단 라벨 / **부제**: 표지 제목 아래 한 줄
- **캡션**, **해시태그**: 인스타 캡션으로 합쳐짐
- 실패 시 상태가 `실패`로 바뀌고 **오류 메모**에 원인이 기록됩니다

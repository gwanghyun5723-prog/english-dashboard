# 영어 학습 대시보드 (GitHub Pages)

Notion의 Daily Lessons · Expression Bank · Review Log를 30분마다 읽어 정적 사이트로 게시합니다.

```
GitHub Actions (30분마다 / 수동 실행)
  └ scripts/build.mjs 가 Notion API 읽기  ← NOTION_TOKEN 은 GitHub Secrets 에만 있음
      └ public/data.json 생성 → GitHub Pages 배포
휴대폰 브라우저 → index.html → data.json 읽기 (‘새로고침’ = 최신 data.json 다시 받기)
```

> ⚠️ 이 사이트는 **공개**입니다. 주소를 아는 사람은 레슨 본문·발화·교정·학습 시간을 볼 수 있습니다.
> 검색엔진 수집은 `noindex`와 `robots.txt`로 막아 두었지만, 링크 공유까지 막지는 못합니다.

## 비용
모두 무료입니다. 무료 계정에서 GitHub Pages와 Actions를 무료로 쓰려면 저장소가 **Public**이어야 합니다.
코드는 공개되지만 Notion 토큰은 Secrets에 저장되어 보이지 않습니다.

---

## 설정 (약 15분)

### 1. Notion 통합 만들기 — 읽기 전용
1. https://www.notion.so/profile/integrations 에서 **새 통합** → 유형 **내부(Internal)** → 학습 허브가 있는 워크스페이스 선택.
2. **기능(Capabilities)** 에서 **콘텐츠 읽기만** 켜고, 콘텐츠 업데이트·삽입은 끕니다.
   토큰이 새더라도 Notion 내용을 바꿀 수 없게 하기 위해서입니다.
3. **내부 통합 시크릿**을 복사해 둡니다. (`ntn_` 로 시작) — 다른 곳에 붙여넣거나 채팅에 보내지 마세요.
4. Notion에서 **English Learning Hub** 페이지 → 오른쪽 위 `⋯` → **연결(Connections)** → 방금 만든 통합 추가.
   허브 아래의 세 데이터베이스가 함께 공유됩니다.

### 2. GitHub 저장소 만들기
1. https://github.com/new → 이름 예: `english-dashboard` → **Public** → 만들기.
2. 이 폴더의 파일을 그대로 올립니다.
   - 웹에서 올릴 때: **Add file → Upload files** 로 `public`, `scripts`, `README.md`를 끌어다 놓습니다.
   - `.github/workflows/deploy.yml`은 숨김 폴더라 업로드가 안 될 수 있습니다. 그럴 땐
     **Add file → Create new file** 에서 파일 이름에 `.github/workflows/deploy.yml` 을 입력하고 내용을 붙여넣습니다.

### 3. 토큰 등록
저장소 **Settings → Secrets and variables → Actions → New repository secret**
- Name: `NOTION_TOKEN`
- Secret: 1-3에서 복사한 값

### 4. Pages 켜기
**Settings → Pages → Build and deployment → Source: GitHub Actions**

### 5. 첫 빌드
**Actions** 탭 → **Build dashboard from Notion** → **Run workflow**.
초록색 체크가 뜨면 주소가 생깁니다: `https://<GitHub아이디>.github.io/english-dashboard/`

휴대폰에서 열고 공유 버튼 → **홈 화면에 추가** 하면 앱처럼 쓸 수 있습니다.

---

## 평소 사용
- **자동 갱신**: 30분마다 Notion을 다시 읽습니다. (GitHub 사정으로 몇 분 늦을 수 있음)
- **새로고침 버튼**: 가장 최근 빌드 결과를 다시 받아옵니다. Notion을 직접 읽지는 않습니다.
- **바로 반영**: GitHub 앱/웹 → Actions → Build dashboard from Notion → **Run workflow**. 1~2분 뒤 새로고침.
- 화면 위 상태줄에 **Notion 반영 시각**이 나옵니다. 2시간 넘게 안 바뀌면 경고가 뜹니다.

## 문제가 생기면
| 증상 | 확인할 곳 |
|---|---|
| “아직 데이터 파일이 없습니다” | Actions 첫 빌드가 끝났는지 |
| “데이터가 오래되었습니다” | Actions 탭에서 빨간 실패 기록 → 로그의 `Notion 401/404` 메시지 |
| `Notion 401 unauthorized` | `NOTION_TOKEN` 값이 맞는지 |
| `Notion 404 object_not_found` | 1-4 단계(허브 페이지에 통합 연결)를 했는지 |
| 자동 갱신이 멈춤 | GitHub는 **60일 동안 저장소에 활동이 없으면 예약 실행을 끕니다.** Actions 탭에서 다시 켜거나 아무 커밋이나 하나 올리세요. |

## 집계 규칙
- 실제 레슨·학습시간: Status = **Complete** 인 레슨만
- 무힌트 전이·D14 유지율: Status = **Assessed** 이고 Evidence·Actual·Score가 있는 복습만
- **Sample, Template** 은 목록에만 보이고 지표에서는 빠집니다.

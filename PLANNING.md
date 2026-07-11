# bumang-blog — 기획 · 핵심 결정 (정본)

개인 블로그 + 포트폴리오(bumang.xyz)의 기획·핵심 결정을 여기에 축적한다. 최신이 맨 위.

> 이 파일이 이 프로젝트 결정의 **정본**이다. 매니저(`private/memory/`)는 이 파일을 참조해 **종합만** 한다. 프론트/백 실행 세부는 각 하위 repo(`bumang-blog-{front,backend}/CLAUDE.md`)·코드가 정본. 글 작성 톤앤매너는 `BLOG_GUIDE.md`가 별도 정본.

## 2026-07-11 · 블로그 삽화 다이어그램 생성 레시피 (스킬화 보류)
- **결정**: 글 중간 삽화 다이어그램을 Claude가 뽑는 워크플로 확립. 스킬화(`/diagram` 류)는 usage 축적 후로 보류.
- **레시피**: ① SVG 손작성 — 박스+커넥터, 자체 배경 패널(off-white)로 라이트/다크 무관, 한글은 폰트에 `'Apple SD Gothic Neo'` 포함. ② 래스터화는 **Chrome headless**(`--headless --force-device-scale-factor=2 --window-size=W,H --screenshot`)로 2x. ⚠️ `qlmanage -t`는 정사각형 크롭 버그로 **금지**. ③ 결과는 Read 툴로 눈으로 검증.
- **보관/발행**: 원본 SVG는 `drafts/assets/`에 두고(git 추적), 발행은 BlockNote 에디터에 드래그 업로드(→ 백엔드/S3). `public/`에 두지 않음.
- **첫 사례**: `drafts/assets/workspace-diagram.{svg,png}` (AI-Workspace 매니저 → 3개 프로젝트 트리).
- **상태**: 레시피 확정 · 스킬화 보류(usage 축적 중).

## 2026-07-05 · 콘텐츠·UI 방향
- 버튼 색을 `primary`/`secondary` 시맨틱 토큰으로 통일, 확인 모달 다크모드 대응, 인프라 그룹 썸네일·OG 배너 정비, 미사용 애셋 정리.
- **상태**: 진행 중(운영 라이브).

## 스택: TypeORM 유지 (Drizzle 아님)
- **결정**: 포트폴리오에서 유일하게 **TypeORM**을 쓴다. 스택 시그니처(Drizzle)에서 벗어난 **의도된 역사적 이탈** — 가장 오래되고 성숙한 프로젝트라 그 시절 선택이 굳었다.
- **Drizzle 이관**: 지금 하지 않는다. 운영 중(bumang.xyz 라이브)이라 이관 리스크가 큼. 부채로 인지하되 우선순위 낮음.
- **상태**: 확정(유지) / 이관 보류.

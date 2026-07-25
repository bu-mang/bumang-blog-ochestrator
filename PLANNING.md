# bumang-blog — 기획 · 핵심 결정 (정본)

개인 블로그 + 포트폴리오(bumang.xyz)의 기획·핵심 결정을 여기에 축적한다. 최신이 맨 위.

> 이 파일이 이 프로젝트 결정의 **정본**이다. 매니저(`private/memory/`)는 이 파일을 참조해 **종합만** 한다. 프론트/백 실행 세부는 각 하위 repo(`bumang-blog-{front,backend}/CLAUDE.md`)·코드가 정본. 글 작성 톤앤매너는 `BLOG_GUIDE.md`가 별도 정본.

## 2026-07-26 · 로그인 감사 로그 (host 전용) + 레이트리밋 실IP 수정
- **결정**: 로그인 시도(성공·실패 **전부**)를 **누가·언제·어디서·무엇으로**를 DB에 남기고, **host만** 보는 페이지(`/admin/audit-logs`)를 만든다. 겸사겸사 같은 뿌리 문제인 **로그인 레이트리밋의 실IP 미해결**을 함께 고친다.
- **왜 지금**: 과거 로그인 이력은 회고 불가로 확인됨(DB 미저장 + `app.log`는 컨테이너 내부라 재생성 때 소실 + Cloudflare 무료플랜은 개별 요청로그 미제공). **이 기능 배포 시점이 기록의 day 0.**
- **데이터 모델** (`login_attempts` 테이블): `email`(시도값, 없는 계정도 저장), `userId`(nullable FK), `success`, `failureReason`(user_not_found|password_mismatch|null), `ip`, `country`, `city`, `userAgent`, `createdAt`.
- **위치 해석 (핵심 결정)**: 앱이 Cloudflare 뒤라 —
  - **국가**: Cloudflare `CF-IPCountry` 헤더(공짜·권위 있음·~99%).
  - **실 IP**: Cloudflare `CF-Connecting-IP`(nginx 뒤라 `req.ip`는 프록시 IP로 찍힘 → 헤더 필수).
  - **도시**: `geoip-lite`(로컬 DB, 오프라인, 외부 API 의존 0)로 **"대략"** 표시. 구·동 단위는 IP로 불가(ISP 게이트웨이 위치라 광역시 급이 한계) — UI에 "대략" 라벨.
- **레이트리밋 동반 수정**: 로그인 5회/분·가입 3회/분이 걸려 있으나 `trust proxy` 미설정이라 `req.ip`가 nginx IP로 잡혀 **전역 공용 버킷**(사람별 격리 안 됨 + 공격자 1인이 전체 로그인 잠글 수 있음). Throttler `getTracker()`를 **`CF-Connecting-IP` 기준**으로 오버라이드해 사람별로 만든다. (감사로그 IP 처리와 동일 근원.)
- **보존 정책**: **최근 1,000건**만 유지(insert 후 초과분 trim-on-write). 무한 증식 차단 — 2026-07-26 디스크 포화 502 교훈의 연장선. DB 테이블이라 야간 pg_dump→S3 백업에도 자동 포함.
- **접근 제어**: 백엔드 `@Roles(HOST)` 가드(`user-groups.controller` 패턴). 프론트는 `middleware.ts`의 `/admin/*` host 보호 + 클라이언트 역할 체크 이중.
- **구현 훅 지점** (조사 완료): 백엔드 로그인 성공/실패는 이미 `auth.service.ts`의 `logAuth()` 3지점 → 여기에 DB 저장(`AuditService`) 병행. IP/UA 추출은 `auth.controller.ts` 로그인 핸들러에서 `@Req()`로. 프론트는 `admin/groups` 페이지 구조 복제 + shadcn `table`(현재 없음, 신규 추가) + TanStack Query.
- **부수 정리**: 로그인 핸들러의 디버그 `console.log('📍 Response headers'...)` 잔재 제거.
- **상태**: 기획 확정 · 구현 착수(백엔드 → 프론트). 배포는 사용자 확인 후.

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

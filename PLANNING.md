# bumang-blog — 기획 · 핵심 결정 (정본)

개인 블로그 + 포트폴리오(bumang.xyz)의 기획·핵심 결정을 여기에 축적한다. 최신이 맨 위.

> 이 파일이 이 프로젝트 결정의 **정본**이다. 매니저(`private/memory/`)는 이 파일을 참조해 **종합만** 한다. 프론트/백 실행 세부는 각 하위 repo(`bumang-blog-{front,backend}/CLAUDE.md`)·코드가 정본. 글 작성 톤앤매너는 `BLOG_GUIDE.md`가 별도 정본.

## 2026-08-02 · 콘텐츠 조회 감사 로그 (로그인 유저 한정) + 조회수 dedup 검토
- **발단**: "조회수는 로그인 안 해도 올릴 수 있지?"에서 출발해 확인해보니 `POST /posts/:id/view`가 **가드도 레이트리밋도 없는 완전 공개 엔드포인트**였다. 중복 방지가 프론트 `sessionStorage` 하나뿐이라 시크릿 창·curl 루프로 무제한 증가 가능. `ThrottlerModule`은 `APP_GUARD`로 등록돼 있지 않아 이 라우트엔 적용조차 안 된다.
- **결정**: 조회수 dedup(IP+postId)은 **보류**하고, 먼저 **로그인 유저의 콘텐츠 조회 감사 로그**를 만든다. 로그인 감사 로그의 자연스러운 확장이고, 이 블로그는 권한 제어가 핵심 기능이라 "누가 무엇을 봤나·무엇에서 막혔나"가 조회수 정확도보다 값어치가 크다.
- **범위 (핵심 결정)**: **로그인 유저만** 기록한다. 익명까지 남기면 볼륨이 자릿수로 커지고 조회수 dedup과 역할이 겹친다.
- **훅 지점**: `POST /posts/:id/view`가 아니라 **`GET /posts/:id`**(`posts.controller.findPostDetail`). `/view`는 세션당 1회·본인 글 제외라 누락투성이인 반면, 상세 조회는 SSR·새로고침 포함 **매 접근**마다 돌아 "모두 남긴다"에 부합. IP/UA는 `@Req()` + 기존 `extractRequestMeta()` 재사용.
- **기록 필드**: `userId`/`userEmail`(스냅샷) · `postId`/`postTitle`(스냅샷) · **`denied`**(readPermission 미달 403) · **`maskedBlockCount`**(audience 불일치로 가려진 블록 수) · ip/country/city/userAgent. denied·masked가 이 블로그에서 감사 가치가 가장 높은 신호 — 지금까지 "권한 없는 글을 누가 열려 했는지"가 전혀 안 남고 있었다.
- **보존 정책 (로그인 감사 로그와 다름)**: **730일 기간 기준**, 자정 크론(`TasksService`) 배치 삭제. 로그인 시도의 **건수 캡 1,000 + trim-on-write를 쓰지 않는 이유**는 볼륨 차이 — 매 조회마다 `count()`를 도는 건 낭비다. 감사 로그로선 "언제부터의 기록인가"가 예측 가능한 기간 기준이 더 유용.
- **성능**: 기록은 `await`하지 않는다(`void`). 매 페이지 로드에 DB 왕복을 얹지 않기 위함. 대신 `recordContentView`는 `recordLoginAttempt`와 같이 **절대 throw하지 않는다**(안 그러면 unhandled rejection).
- **404는 기록하지 않음**: 없는 글 요청은 감사 가치가 없다. 403(denied)만 예외 경로에서 기록.
- **접근 제어**: `AuditController`가 이미 클래스 레벨 `@Roles(HOST)`라 메서드 추가만으로 잠긴다. 프론트는 `/admin/audit-logs`에 **탭 추가**(로그인 시도 / 콘텐츠 조회).
- **로컬 검증 완료**: 익명 조회 → 미기록 / host 성공 → 기록 / guest가 member 전용 글 → `denied=true` 기록 / 404 → 미기록. `/audit/content-views`가 host 200 · guest 403 · 익명 401. 브라우저로 탭 UI 렌더까지 확인.
- **남은 것 (조회수 dedup, 미착수)**: 하기로 하면 **날짜 버킷 + UNIQUE(postId, visitorKey, dayBucket) + `ON CONFLICT DO NOTHING`** 방식. 롤링 24시간(SELECT→INSERT)은 레이스가 있어 배제. visitorKey는 salt 해시(IP+UA, IPv6는 /64 절단), 로그인 유저는 `user:<id>`. 보존은 2일 크론. 프론트 `sessionStorage`는 "요청 절약" 역할로 유지.
- **상태**: 구현 완료 · 로컬 검증 완료 · **배포 전**(사용자 확인 대기).

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
- **테스트 중 발견·수정한 버그**: `validateOneUserPasswordByEmail`이 계정없음에 **예외를 던져서**, 기존 `if(!user)`의 `login_user_not_found` 기록이 죽은 코드였음(없는 계정 시도가 하나도 안 잡히던 잠재 버그). try/catch로 잡아 기록하도록 수정. 로컬 e2e로 발견.
- **상태**: **배포 완료 (2026-07-28)** — 백엔드(`f3535fd`)·프론트(`62e29cd`) 양쪽 push→Actions→마이그레이션·전체 재생성 확인. prod 실측으로 **CF-IPCountry 도달 확인(토글 ON)**, `CF-Connecting-IP`로 실 클라이언트 IP 획득, geoip가 실 ISP IP엔 도시(예: Gangnam-gu)까지 뽑음(테스트/anycast IP는 빈 값). 로그인 5·가입 3/분 레이트리밋이 CF 실IP 기준으로 사람별 격리됨(로컬에서 같은IP 6회째 429·다른IP 통과 확인). prod 감사 테이블 day 0(0건)에서 시작.

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

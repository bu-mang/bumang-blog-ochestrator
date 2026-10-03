# bumang-blog — 기획 · 핵심 결정 (정본)

개인 블로그 + 포트폴리오(bumang.xyz)의 기획·핵심 결정을 여기에 축적한다. 최신이 맨 위.

> 이 파일이 이 프로젝트 결정의 **정본**이다. 매니저(`private/memory/`)는 이 파일을 참조해 **종합만** 한다. 프론트/백 실행 세부는 각 하위 repo(`bumang-blog-{front,backend}/CLAUDE.md`)·코드가 정본. 글 작성 톤앤매너는 `BLOG_GUIDE.md`가 별도 정본.

## 2026-10-03 · 서버를 t4g.micro로 — 메모리 다이어트 (373MB 백엔드 → 컨테이너 전체 250MB)
- **계기**: "블로그가 느리다" 조사 중 백엔드 컨테이너가 한도 384MB 중 373MB(97%)를 쓰며 스왑을 타는 것을 발견. 9월에도 같은 방식(SIGTRAP)으로 3번 죽은 기록이 코어 덤프 목록에 있었다(9/1·9/5·9/10, 원인 로그는 재배포로 소실).
- **원인과 조치**
  - `geoip-lite`가 IP DB 전체(약 210MB, V8 힙 바깥 Buffer)를 상주 → **제거**, 도시는 Cloudflare 위치 헤더(`cf-ipcity`)로 대체.
  - Prometheus 지표: 수집 서버(prometheus 컨테이너)는 이미 없는데 앱이 지표를 계속 쌓았고, 라벨에 쿼리스트링 포함 URL을 넣어 고유 URL마다 시계열이 늘어나는 누수(URL당 약 0.9KB, 실제 누적은 수 MB 수준) → **주석 처리로 끔**(코드·설정은 보존, 다시 켤 때는 라우트 패턴 라벨로).
  - 1년 넘게 재부팅 안 해 쌓인 커널 회수 불가 메모리 224MB → **재부팅**으로 51MB.
  - 시스템 저널 2GB → 한도 **50MB**. 프로덕션 Swagger 노출(`/api-docs` 공개) → **개발 환경에서만**.
  - sharp(libvips) 메모리 캐시(기본 50MB, 이 구조에선 적중 거의 없음) → **끔**(`instrumentation.node.ts`).
- **안전장치**: 컨테이너 한도 백엔드·프론트 **256MB**, 힙 상한 192/160(`--max-old-space-size`), 치명 오류 시 Node 진단 리포트(`--report-*`, `--report-exclude-env` 필수 — 없으면 환경변수 비밀값이 리포트에 담김), 로그·리포트는 호스트 `/var/log/bumang-blog/`(재배포에도 보존), 코어 덤프는 "기록만"(`/etc/systemd/coredump.conf.d/10-no-dump.conf`). certbot에 재시작 정책 추가(없으면 재부팅 후 인증서 갱신이 조용히 멈춤).
- **배포 마이그레이션**: ts-node로 src를 즉석 컴파일하면 256MB를 꽉 채움(실측). → `migration:run:prod`(빌드된 `dist/` 실행, 실측 26MB·1초)로 변경.
- **결과**: 호스트 사용 830MB → 376MB(재부팅 직후). **t4g.small → t4g.micro 전환 완료**(월 $15.18 → $7.59). 전환 직후 382MB/916MB, 스왑 0. 탄력적 IP라 주소 그대로.
- **함정**: ① 백엔드 `types/`의 유일한 파일을 지우자 tsc 출력이 `dist/src/main.js` → `dist/main.js`로 바뀌어 실행 명령이 깨질 뻔함 → `tsconfig`에 `rootDir: "./"` 고정. ② 프론트 설정도 백엔드 레포의 compose에 있어서, 프론트가 먼저 배포되면 옛 compose로 뜬다 → 백엔드 배포 후 `up -d frontend` 필요. ③ **한도에 붙은 프로덕션 컨테이너 안에서 진단용 node를 띄우지 말 것** — 10-03 새벽 그것이 백엔드 본체를 죽였고, 코어 덤프를 쓰는 4분 동안 API가 멈췄다.
- **OS 업데이트**: Amazon Linux 2023은 설치 릴리스에 고정돼 `dnf upgrade`가 "받을 것 없음"으로 나온다 — 그래서 2025-05 릴리스·커널로 1년 넘게 보안 패치 없이 돌았다. 10-03 `dnf upgrade --releasever=latest`로 2023.12(2026-09-30)까지 240개 패키지 업데이트(커널 6.1.134 → 6.1.188, containerd 1.7 → 2.2) 후 재부팅. 중단 약 1분.
- **월 1회 자동 정비**: `monthly-maintenance.timer`(매월 첫째 일요일 04:00 KST) → DB 덤프(최근 3개) → 최신 릴리스 업데이트 → 미사용 이미지 정리 → 커널이 바뀌었으면 재부팅 → 부팅 후 프론트·API 응답 확인. 기록은 서버 `/var/log/monthly-maintenance.log`. 실패 알림은 없음(로그만). 스크립트는 서버 `/usr/local/sbin/monthly-maintenance.sh`, `maintenance-healthcheck.sh`(레포 밖).
- **상태**: 확정·배포 완료. 며칠 뒤 스왑·컨테이너 메모리 재측정(기준: 스왑 수백 MB, 컨테이너 200MB 이상이면 부족 신호).

## 2026-10-03 · 인증 재구성 — access JWT 15분 + 기기별 refresh 세션, 사용자는 서버에서 확정
- **결정**
  - refresh 토큰: `users.refreshToken`(계정당 1개·평문·JWT) → **`refresh_session_entity`(기기당 1행, 256비트 난수, DB엔 SHA-256 해시만)**. 마지막 사용 후 30일 슬라이딩, 유저당 최대 10개, 자정 크론이 만료분 삭제. 9월에 보류했던 "기기 간 서로 로그아웃" 해결.
  - 토큰 수명 단일 출처 `auth/const/token.const.ts`: access 15분, refresh 30일. 쿠키 수명 = 토큰 수명.
  - 프론트는 **서명 키(`JWT_SECRET`)를 갖지 않는다**. 미들웨어는 서명 검증 없이 만료·역할만 읽어 갱신·리다이렉트만 하고, 실제 경계는 백엔드 가드. 서버의 프론트 env에서도 삭제함.
  - 로그인 사용자는 루트 레이아웃이 `getCurrentUser()`로 조회해 `AuthProvider` → `useAuth()`. zustand 스토어·`isAuthLoading` 제거. 익명 방문자의 페이지당 실패 호출 2번(프로필 401→갱신 401)이 0번이 됨.
  - 갱신은 두 곳: 페이지 요청은 미들웨어(내부 주소 `app:4001`로 직행), 브라우저 API 호출은 axios 인터셉터. `OptionalJwtAuthGuard`는 access 없고 refresh 쿠키 있으면 401(로그인 사용자가 마스킹된 익명 응답을 받지 않게).
  - 레이트리밋: 프론트 미들웨어(메모리 Map) → **백엔드 전역 `CfThrottlerGuard`(APP_GUARD, 방문자 IP당 분당 300회)**. 원래 `ThrottlerModule` 설정만 있고 가드가 가입·로그인에만 붙어 있어 나머지 API는 무제한이었다.
  - refresh 토큰을 찍던 `console.log` 등 인증 디버그 로그 전부 제거.
- **기각**: refresh 토큰 로테이션 — 새 토큰을 실은 응답이 취소되면(Next 프리페치) 멀쩡한 세션이 끊기는 위험이 이득보다 큼. 순수 세션 방식 — 구조 갈아엎기 대비 이득 작음.
- **알려진 한계·미구현**: 레이아웃의 사용자 값은 링크 이동 때 갱신되지 않음(표시용으로만 사용). 탈취 대응 수단(모든 기기 로그아웃, 비밀번호 변경, 세션 절대 상한) 없음. `getCurrentUser()` 시간 제한 없음(백엔드가 멈추면 로그인 사용자 페이지가 같이 대기).
- **상태**: 확정·배포 완료(백엔드 `dc6a5db`, 프론트 `5085335`). 배포 시 기존 로그인 1회 해제됨. 구조도: https://claude.ai/artifact/Kr5YFbPmjD55sMAHwhtcYz

## 2026-10-03 · 엣지는 Cloudflare 유지 — 봇 차단은 WAF, 오리진은 Cloudflare 대역만
- **결정**: 봇 차단(UA 목록)을 프론트 미들웨어에서 **Cloudflare WAF 커스텀 규칙**(`Block bad bots`)으로 이동 — 요청이 Node까지 오기 전에 막히고 api 도메인도 덮는다. EC2 보안 그룹 80·443을 **Cloudflare IPv4 15개 대역만** 허용(직접 접속 시 WAF 우회 차단 확인). SSH 22는 GitHub Actions 배포 때문에 전체 개방 유지(비밀번호 로그인 꺼짐, 키 1개).
- **함의**: Cloudflare 프록시를 유지하므로 LA 경유 문제를 DNS only로 푸는 길은 닫힘.
- **미결**: KT 회선이 무료 플랜 `bumang.xyz`를 LAX 엣지로 받음(같은 13KB가 LAX 0.6~5.7초, ICN 0.07~0.3초). 감사 로그에 `colo`(경유 엣지)를 쌓기 시작 — 며칠 데이터로 한국 방문자의 LAX 비율을 보고 유료 플랜 여부 판단.
- **감사 로그 확장**: `region`(시/도)·`colo`·`referer`(콘텐츠 조회만) 컬럼 추가, 도시는 `cf-ipcity`.
- **상태**: WAF·보안 그룹 적용 완료, LAX 대응 미결.

## 2026-10-03 · 발견했지만 손대지 않은 것
- `/ko/work/anttime-swap` 프로덕션 500 — `content/work/anttime-swap/` 없음.
- 마이그레이션만으로 만든 DB엔 `post_entity.thumbnailUrl`·`type` 컬럼이 없음(프로덕션 DB엔 있음) → 새 환경 구성 시 글 조회 500.
- `user_entity.refreshToken` 컬럼: 코드에선 미사용, 무중단 배포 때문에 DB에 남김 → 별도 마이그레이션으로 삭제.
- PostgreSQL `shared_buffers` 128MB > DB 컨테이너 한도 100MB(지금 DB 10MB라 무해, 커지면 32MB로).
- 서버의 옛 Prometheus·Grafana 볼륨 367MB(디스크만 차지).

## 2026-10-02 · 느린 로드의 진범은 S3가 아니라 꺼져 있던 이미지 최적화
- **원인**: 프론트에 `sharp`가 없어 Next standalone의 `/_next/image`가 리사이즈에 실패하고 원본(1.5MB PNG)을 그대로 내보내고 있었다. 판별법: 폭을 바꿔 요청해도 `content-length`가 같으면 원본 fallback.
- **조치**
  - `sharp` 추가, `images.minimumCacheTTL` 1년, Cloudflare Cache Rule(`/_next/image*`), 최대 폭 2048(`deviceSizes`).
  - S3 기존 이미지 워싱: PNG 28개 팔레트 압축 + GIF 2개 128색(키 유지라 DB 수정 없음, 1년 캐시 헤더) — 37.5MB → 10.7MB. 원본 백업 `~/Work/private/bumang-blog-s3-backup-2026-10-03/`.
  - 업로드 시 압축: 에디터 파일은 브라우저, 외부 URL은 서버(sharp)에서 가로 2048·세로 4096 이하 webp q85. GIF·webp·avif는 원본.
  - 프론트 레포 정적 파일 198MB → 62MB: 참조 없는 파일 삭제, 그룹 배너 7장 4K PNG(87MB) → 1440px webp(2MB), `lily.glb` 54만 → 7.2만 삼각형(20MB → 2.7MB). Docker 이미지 482MB → 331MB.
  - `public/images/work/SEA-PEARL` → `sea-pearl`(프로덕션 Linux에서 대소문자 불일치로 404였음).
- **남은 것**: public의 포트폴리오 GIF 6개(20MB)는 색을 줄이면 배경색이 바뀌고 색을 유지하면 안 줄어 그대로 — 동영상 변환이 정답. 기존 글 이미지의 webp 전환은 본문 URL 수정이 필요해 보류.
- **상태**: 확정·배포 완료.

## 2026-09-06 · SSR → 백엔드는 내부 주소로 직행 (Cloudflare 우회) + 익명 조회 감사 로그 후속
- **인시던트**: 익명 조회 감사 로그(백엔드 `3eebde5`)와 짝으로 프론트 `c53650d`가 SSR `serverFetch`에 방문자 헤더(`cf-connecting-ip`·`cf-ipcountry`·`x-forwarded-for`·`user-agent`) 전달을 넣었는데, SSR이 백엔드를 **공개 주소(`api.bumang.xyz`)** 로 부르고 있어 그 요청이 Cloudflare를 다시 통과했다. **Cloudflare는 외부 유입 요청에 `cf-connecting-ip`가 이미 붙어 있으면 값과 무관하게 403(error 1000)** 을 준다 → 프로덕션의 **모든 글 상세 SSR이 실패**(로그인 여부 무관). 화면엔 에러 대신 "loading..." 폴백만 떴는데, `serverFetch`가 실패 body를 `json()`→`text()` 순으로 두 번 읽다 "Body is unusable"로 status를 잃어 401/403 리다이렉트 분기가 죽어 있었기 때문. 로컬은 Cloudflare 헤더가 애초에 없어 재현 불가였다.
- **결정**: 프론트와 백엔드가 **같은 EC2·같은 compose 네트워크**인데 인터넷→Cloudflare→nginx를 한 바퀴 돌아 옆 컨테이너로 들어오던 구조 자체를 없앤다. 서버 전용 env **`API_INTERNAL_URL=http://app:4001`** 을 compose `frontend.environment`에서 주입하고, `serverFetch`는 공개 주소로 시작하는 URL의 앞부분만 이 값으로 바꿔 부른다. 브라우저는 그대로 `NEXT_PUBLIC_API_BASE_URL`.
- **안전장치**: `cf-connecting-ip`는 **내부 경로일 때만** 전달하고 공개 경로로 나갈 땐 호출부가 넣었어도 지운다 — env 주입이 빠지거나 배포 순서가 꼬여도 장애로 돌아가지 않게. 에러 body는 텍스트로 한 번만 읽고 JSON 파싱을 그 위에서 시도.
- **부수 이득**: 백엔드 레이트리밋(`CfThrottlerGuard`)이 SSR 트래픽을 그동안 EC2 공인 IP 하나로 묶어 봤는데, 이제 방문자 IP별로 격리된다. SSR 왕복 지연도 제거.
- **배포 함정**: compose 파일은 백엔드 레포에 있고 프론트 Actions는 서버 디스크의 compose로 `up -d frontend`한다 → **백엔드 먼저 배포(compose 갱신)→프론트 배포** 순서여야 새 env가 붙는다. 반대로 가도 안전장치 덕에 페이지는 살지만 감사 로그 IP가 서버 IP로 찍힌다.
- **미확인**: 로컬 검증 중 한 페이지 렌더에 백엔드 GET이 2회 관측됨(403 경로). `c53650d`의 React `cache()` 중복 접기가 실패 응답에선 안 먹거나 dev 한정일 수 있음 — prod 감사 로그에서 한 조회당 행 수로 확인 필요.
- **상태**: **배포 완료 (2026-09-06 21:44)** — 백엔드(`f5fb534`)→프론트(`627dcbd`) 순. prod 감사 로그에서 방문자 IP·실제 UA로 찍히는 것 확인(그 전 행은 EC2 IP + UA `node`). 한 조회당 한 행이라 `cache()` 중복 접기도 prod에서 정상(위 "미확인" 해소).

## 2026-09-06 · 잦은 로그아웃 원인 두 가지 — 미들웨어만 고치고 세션 테이블은 보류
- **원인 ①**: 리프레시 토큰이 `users.refreshToken` 컬럼 **하나**라 기기 두 대(Mac·Android)로 쓰면 나중 로그인이 앞 것을 덮어쓰고, 앞 기기의 다음 리프레시가 불일치 → 백엔드가 DB 토큰을 **삭제**(`renewAccessToken`) → 두 기기 모두 로그아웃. access JWT가 1h라 매시간 이 경로를 탄다.
- **원인 ②**: 프론트 `middleware.ts`가 리프레시 실패를 종류 불문 "쿠키 삭제"로 처리 — `response.ok`만 봐서 500·502·429·fetch throw도 401과 같은 분기. 배포 중 컨테이너 교체·nginx 재시작 구간에 페이지를 열면 30일 토큰이 버려졌다.
- **결정**: ②만 고친다(`dcf1354`: 401일 때만 쿠키 삭제, 그 외는 쿠키 유지하고 진행). ①의 세션 단위 리프레시 토큰 테이블은 **보류** — 사용자가 혼자뿐이고 로그인 유지가 중요치 않다는 판단. 기기 두 대를 번갈아 쓰면 여전히 풀릴 수 있음을 알고 감수.
- **상태**: ② 배포 완료 / ① 보류(필요해지면 `refresh_tokens` 테이블 + 해시 저장으로).

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

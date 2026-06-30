# Bumang Blog — 에이전트 가이드 (루트)

`bumang.xyz` 개인 블로그 + 포트폴리오 풀스택 프로젝트. 이 디렉토리 아래에 **2개의 독립 git 레포**가 있다.

| 디렉토리 | 역할 | 스택 | 개발 포트 | 상세 가이드 |
|---|---|---|---|---|
| `bumang-blog-backend/` | REST API | NestJS 10 · PostgreSQL · TypeORM | **4001** | [backend/CLAUDE.md](bumang-blog-backend/CLAUDE.md) |
| `bumang-blog-front/` | 웹 프론트 | Next.js 14 · React 18 | **4000** | [front/CLAUDE.md](bumang-blog-front/CLAUDE.md) |

> ⚠️ **두 디렉토리는 각각 별개의 git 레포다** (둘 다 `main` 브랜치). commit/push는 해당 레포 디렉토리 안에서 따로 한다. 한 작업이 양쪽을 건드리면 **두 번 커밋**해야 한다.

## 프론트 ↔ 백엔드 API 계약

엔드포인트의 **정본(正本)은 백엔드 Swagger**: 개발 중 `http://localhost:4001/api-docs`.

| 프론트 (`front/src/services/api/`) | 백엔드 도메인 (`backend/src/`) |
|---|---|
| `auth/` | `auth/` |
| `blog/` | `posts/`, `categories/`, `tags/`, `comments/` |
| `userGroups/` | `user-groups/`, `categories/` |

프론트는 `front/src/services/index.ts`의 `END_POINTS` 상수로 백엔드 경로를 참조한다. **백엔드 라우트를 바꾸면 이 상수와 해당 `services/api` 함수도 같이 고친다.**

## 공유 도메인 용어집

- **역할 계층**: `guest` < `member` < `host`. (과거 `user/admin/owner`였고 commit `f874b04`에서 리네임됨 — 옛 이름이 보이면 잔재다.)
- **콘텐츠 계층**: `Group` > `Category` > `Tag`. 포스트는 Category에 속하고 Tag와 다대다.
- **접근 제어**: 포스트·블록 단위로 `readPermission` / `audience`. `audience`에 맞지 않는 블록은 백엔드에서 **마스킹**되어 내려가고(`backend/src/posts/util/maskContent.ts`), 마스킹된 블록도 audience 라벨은 노출된다(commit `993c771`, `18ab1f9`).
- **Post `type`**: 포스트 종류 enum (`backend/src/posts/const/type.const.ts`).

## 인증 흐름 (양쪽 공통)

JWT 이중 토큰: **access(단기) + refresh(장기, 백엔드 DB 저장 + 로테이션)**, 둘 다 httpOnly 쿠키.
- 백엔드가 로그인 시 쿠키 설정, refresh로 access 재발급.
- 프론트 `middleware.ts`가 매 요청에서 access 검증 → 만료 시 refresh로 자동 재발급 → 실패 시 쿠키 정리.

## 배포

둘 다 EC2(`ap-northeast-2`) + Docker + GitHub Actions(`.github/workflows/docker-publish.yml`, `main` push 트리거) + Nginx 리버스 프록시 + Let's Encrypt SSL. 프로덕션 도메인 `bumang.xyz` / API `api.bumang.xyz`.

## 블로그 글 작성

사용자가 "블로그 글 써줘" 같은 요청을 하면, 코드가 아니라 **글 콘텐츠** 작업이다. 반드시 [BLOG_GUIDE.md](BLOG_GUIDE.md)를 먼저 읽고, 이어서 [blog-references/](blog-references/)의 실제 글들을 참고해 톤앤매너(평어체 '-다', 불릿 남용 금지, 원인·결과의 풍부한 서술)를 맞춘다.

## 작업 규칙

- 코드/README/커밋은 **한국어**가 기본. 커밋 메시지는 Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
- 커밋·푸시·배포는 **사용자가 명시적으로 요청할 때만** 한다.
- 두 레포는 alias가 다르다: 백엔드 `src/*`·`types/*`, 프론트 `@/*`. 헷갈리지 말 것.

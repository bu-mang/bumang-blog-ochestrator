# bumang-blog-orchestrator

[bumang.xyz](https://bumang.xyz) 개인 블로그 + 포트폴리오 풀스택 프로젝트의 **오케스트레이터 레포**.

실제 애플리케이션 코드는 별도의 두 레포에 있고, 이 레포는 그 둘을 한곳에서 다루기 위한 **공통 가이드·레퍼런스·작업 도구**를 관리한다.

## 구성

```
bumang-blog/
├── bumang-blog-front/     # (별도 레포) 웹 프론트엔드 — .gitignore 처리
├── bumang-blog-backend/   # (별도 레포) REST API — .gitignore 처리
├── CLAUDE.md              # 에이전트/기여 가이드 (루트 컨텍스트)
├── BLOG_GUIDE.md          # 블로그 글 작성 톤앤매너 가이드
├── blog-references/       # 실제 발행 글 샘플 (톤앤매너 레퍼런스)
├── drafts/                # 글 초안 작업 공간
└── .claude/skills/        # 프로젝트 전용 스킬 (글 작성 / 배포 자동화)
```

> ⚠️ `bumang-blog-front/`, `bumang-blog-backend/`는 **각각 독립된 git 레포**다. 이 오케스트레이터는 두 디렉토리를 `.gitignore`로 제외하며, 코드 변경은 해당 레포 안에서 따로 커밋·push한다.

## 애플리케이션 레포

| 레포 | 역할 | 스택 | 개발 포트 |
|---|---|---|---|
| [bumang-blog-front](https://github.com/bu-mang/bumang-blog-front) | 웹 프론트 | Next.js 14 · React 18 | 4000 |
| [bumang-blog-backend](https://github.com/bu-mang/bumang-blog-backend) | REST API | NestJS 10 · PostgreSQL · TypeORM | 4001 |

각 레포의 상세 가이드는 해당 디렉토리의 `CLAUDE.md`를 참고한다.

## 배포

- **front / backend**: 각 레포 `main` push → GitHub Actions(`docker-publish.yml`)가 EC2(`ap-northeast-2`)에 Docker로 자동 배포. 프로덕션 도메인 `bumang.xyz` / API `api.bumang.xyz`.
- **orchestrator**: CI 없음. push = 게시.

세 레포를 한 흐름으로 배포하려면 `.claude/skills/deploy-bumang` 스킬(`/deploy-bumang`)을 쓴다 — 멀티 GitHub 계정 전환까지 자동 처리한다.

## 블로그 글 작성

코드가 아니라 글 콘텐츠 작업은 [BLOG_GUIDE.md](BLOG_GUIDE.md)를 먼저 읽고, [blog-references/](blog-references/)의 실제 글로 톤앤매너(평어체 '-다', 원인·결과의 풍부한 서술)를 맞춘다. `.claude/skills/write-blog-post`(`/write-blog-post`)로 초안을 생성할 수 있다.

## 컨벤션

- 코드/문서/커밋 메시지는 **한국어** 기본.
- 커밋은 [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).

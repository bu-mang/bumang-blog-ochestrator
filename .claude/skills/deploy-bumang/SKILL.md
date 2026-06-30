---
name: deploy-bumang
description: bumang-blog 3개 레포(front·backend·orchestrator)를 bu-mang 계정으로 push해서 배포한다. 멀티계정 인증(회사 bhjeong-camfit ↔ 개인 bu-mang) 전환을 자동으로 처리한다. 사용자가 "배포해줘", "deploy", "push해줘", "/deploy-bumang", "변경사항 올려줘", "프론트/백엔드 배포"라고 하면 이 스킬을 사용한다. 코드 변경을 커밋·push하고 GitHub Actions 배포를 트리거하는 작업이다.
---

# bumang-blog 멀티계정 배포

`bumang-blog`의 3개 레포를 **`bu-mang`(개인 계정) 소유** GitHub로 push한다. 이 머신의 기본 gh 활성 계정은 **`bhjeong-camfit`(회사)** 이라 그냥 push하면 403이 난다. 이 스킬은 계정 전환을 자동으로 끼워 넣어 그 문제를 없앤다.

## 핵심 배경 (왜 이렇게 하는가)

- **레포 소유자**: 세 레포 모두 `bu-mang`(calmness0729@gmail.com) 소유.
  - `bumang-blog-front/` → `bu-mang/bumang-blog-front` (push 시 GitHub Actions docker-publish → EC2 자동 배포)
  - `bumang-blog-backend/` → `bu-mang/bumang-blog-backend` (동일하게 Actions 배포)
  - 루트 `/` → `bu-mang/bumang-blog-ochestrator` (CI 없음, push = 게시. **철자 주의: "ochestrator"** — r 하나 빠짐)
- **인증 우선순위**: gh의 HTTPS git 자격증명은 `git config --global credential.https://github.com.helper = !gh auth git-credential`로 처리되며, 우선순위는 ① `GITHUB_TOKEN`/`GH_TOKEN` env var → ② gh 키링 활성 계정.
- **함정**: 사용자의 인터랙티브 셸은 `~/.zshrc`가 `export GITHUB_TOKEN=gho_...`(회사 토큰, Camfit Playground `setup.sh`가 깐 것 — **지우면 안 됨**)을 깔기 때문에, 그 셸에서 push하면 키링 계정과 무관하게 항상 회사 토큰을 써서 403.
- **그러나 Claude 도구 셸에는 `GITHUB_TOKEN`이 없다**(`.zshrc`를 안 읽음). 그래서 키링 활성 계정만 `bu-mang`으로 바꾸면 Claude가 깨끗하게 push할 수 있다. `bu-mang`은 이미 gh 키링에 로그인돼 있어 `gh auth switch`는 비대화형으로 동작한다.

## 절차

### 1. 사전 점검 (preflight)

각 레포의 상태를 확인한다. 변경/커밋이 없으면 push할 게 없다.

```bash
for d in bumang-blog-front bumang-blog-backend .; do
  echo "=== $d ==="
  git -C "/Users/beomhwan/Work/bumang-blog/$d" status -sb
  git -C "/Users/beomhwan/Work/bumang-blog/$d" log origin/main..HEAD --oneline 2>/dev/null || echo "(origin 비교 불가 — 신규 레포)"
done
```

- **커밋 안 된 변경**이 있으면, 무엇을 커밋할지 사용자에게 확인하고 커밋한다.
  - 커밋 author는 **`Bumang-Cyber <calmness0729@gmail.com>`** 로 맞춘다 (글로벌 user.name 미설정이므로 레포별로 `git -C <repo> config user.name/user.email` 지정).
  - 커밋 메시지는 Conventional Commits + 한국어. 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
  - **CPF 세션 잡파일(`.cpf/`)은 커밋하지 않는다** (각 레포 `.gitignore`에 이미 등록됨).
- origin보다 앞선 커밋(`origin/main..HEAD`)이 있는 레포만 push 대상이다.

### 2. bu-mang 키링 로그인 확인

```bash
gh auth status 2>&1 | grep -E "account|Active"
```

- 출력에 `bu-mang`이 보이면 OK → 3번으로.
- **`bu-mang`이 없으면** (토큰 만료/로그아웃) 비대화형 세션에선 로그인 못 한다. 사용자에게 **본인 터미널에서** 아래 일회성 로그인을 요청하고 대기한다:
  ```bash
  unset GITHUB_TOKEN              # 이 세션에서만 (.zshrc는 그대로)
  gh auth login                  # GitHub.com → HTTPS → 브라우저, bu-mang 으로 승인
  ```
  완료되면 다시 1번부터.

### 3. 활성 계정을 bu-mang으로 전환 + 검증

```bash
gh auth switch --user bu-mang
[ -z "$GITHUB_TOKEN" ] && echo "env 토큰 없음 ✅" || echo "⚠️ GITHUB_TOKEN 있음 — 중단"
gh auth status 2>&1 | grep -A1 "bu-mang"
```

- **Claude 도구 셸에 `GITHUB_TOKEN`이 있으면 절대 진행하지 말 것** — 그러면 회사 토큰으로 push된다. (정상이면 없다.)
- 활성 계정이 `bu-mang`인지 확인되면 push.

### 4. push

origin보다 앞선 커밋이 있는 레포만 push한다.

```bash
git -C /Users/beomhwan/Work/bumang-blog/bumang-blog-front   push origin main
git -C /Users/beomhwan/Work/bumang-blog/bumang-blog-backend push origin main
git -C /Users/beomhwan/Work/bumang-blog                     push -u origin main   # orchestrator
```

### 5. 회사 계정으로 즉시 복귀 (필수 — 빼먹지 말 것)

push 성공 여부와 무관하게 **항상** 복귀시킨다. 실패해도 키링을 회사 계정으로 되돌린다.

```bash
gh auth switch --user bhjeong-camfit
gh auth status 2>&1 | grep -E "account|Active"   # bhjeong-camfit: Active 확인
```

### 6. 보고

- 각 레포 push 결과(refspec)와 어떤 게 배포 트리거됐는지 보고.
- front/backend는 **GitHub Actions(docker-publish)** 가 도는 중이니, 사용자에게 `bu-mang` 레포 Actions 탭에서 성공 확인을 권한다 (현재 활성 계정이 회사라 Claude는 bu-mang Actions 조회 불가).

## 안전 규칙

- bu-mang이 활성인 시간을 **최소화**한다: 전환 → push → 즉시 복귀를 한 흐름으로.
- bu-mang은 회사 레포에 쓰기 권한이 없어, 설령 잘못된 레포에 push해도 403으로 fail-safe. 그래도 이 스킬이 치는 push 명령은 위 3개로 한정한다.
- `~/.zshrc`의 `GITHUB_TOKEN`은 **건드리지 않는다** (회사 플러그인 동작에 필요). 토큰 평문 노출이 신경 쓰이면 별도로 rotate를 권할 수는 있으나 이 스킬의 작업 범위 밖.
- 커밋·push는 사용자가 명시적으로 요청할 때만 (이 스킬 호출 자체가 그 요청).

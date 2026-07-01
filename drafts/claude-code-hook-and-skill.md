---
title: Claude Code의 Hook과 Skill, 그리고 둘을 엮는 법
previewText: 잘못된 깃허브 계정으로 push했다가 403을 맞고서, 그 실수를 원천 차단하는 PreToolUse hook을 만들었다. 그 과정에서 정리한 hook의 정체와 skill과의 조합 방식.
type: dev
category: Claude Code
tags: [Claude Code, Hook, AI]
readPermission: null
thumbnailUrl: null
---

# Claude Code의 Hook과 Skill, 그리고 둘을 엮는 법

개인 블로그 레포를 정리하다가 Claude Code로 배포를 맡겼는데, `git push`가 403으로 튕겼다. 원인은 시시했다. 이 맥북은 회사 깃허브 계정(`bhjeong-camfit`)으로 로그인돼 있는데, 블로그 레포들은 개인 계정(`bu-mang`) 소유였다. 회사 계정엔 개인 레포에 쓸 권한이 없으니 당연히 막힌 것이다. 게다가 `~/.zshrc`가 회사 토큰을 `GITHUB_TOKEN` 환경변수로 깔아두고 있어서, `gh` 계정을 바꿔도 그 토큰이 우선순위에서 이겨버렸다.

계정을 개인 것으로 잠깐 전환했다가 push하고 다시 회사 계정으로 돌아오는 흐름으로 문제는 풀렸다. 그런데 이게 매번 반복될 일이고, 무엇보다 **깜빡하고 회사 계정인 채로 push를 시도하는 실수**가 언제든 다시 날 수 있었다. 그래서 그 실수 자체를 막는 안전장치를 Claude Code의 hook으로 만들었다. 이 글은 그 과정에서 정리한 것들이다. hook이 대체 뭔지, 어떻게 설계하는지, 그리고 skill과 어떻게 엮으면 좋은지.

## Hook은 파일이 아니라 계약이다

처음 hook을 만들 때 가장 헷갈렸던 건 "무엇이 hook을 hook으로 만드는가"였다. 결론부터 말하면, hook 파일 자체엔 hook다운 구석이 하나도 없다. 내가 만든 건 그냥 평범한 노드 스크립트 한 개다. 이걸 hook으로 만드는 건 파일 안이 아니라 바깥의 두 가지다.

하나는 **등록**이다. `.claude/settings.json`에 "어떤 이벤트에, 어떤 명령을 실행하라"고 적어두면, 그때부터 Claude Code의 하네스가 그 스크립트를 불러준다. 다른 하나는 **입출력 계약**이다. 하네스는 정해진 규약으로 스크립트와 대화한다. 입력은 표준입력(stdin)으로 JSON을 주고, 스크립트는 종료코드로 답한다. `0`이면 통과, `2`면 차단이다. 차단할 때 표준에러(stderr)에 쓴 메시지는 Claude에게 그대로 전달된다.

그러니까 hook이란 **"실행 가능한 명령 × settings.json 등록 × stdin/종료코드 규약"**의 조합이다. 이 규약만 지키면 언어는 아무래도 상관없다. bash든 python이든 컴파일된 바이너리든 된다. 내 경우는 우연히 노드였을 뿐이다.

여기서 한 가지 오해를 짚고 넘어가야 한다. hook은 백그라운드에서 뭔가를 계속 감시하는 데몬이 아니다. 상시 돌면서 여러 조건을 지켜보는 게 아니라, **하네스가 특정 생명주기 이벤트에 도달할 때마다 스크립트를 새로 실행했다가 버리는** 구조다. 이벤트가 나면 프로세스가 태어나 판단하고 종료코드를 남기고 죽는다. 이벤트 사이엔 아무것도 돌지 않는다. 감시(polling)가 아니라 콜백(callback)이라고 보면 정확하다.

이벤트는 아무 때나 발생하지 않고, 하네스가 정해둔 목록에서만 걸린다.

| 이벤트 | 언제 |
|---|---|
| `PreToolUse` | 툴 실행 직전 (여기서만 차단 가능) |
| `PostToolUse` | 툴 실행 직후 |
| `UserPromptSubmit` | 사용자가 메시지를 보낼 때 |
| `SessionStart` / `SessionEnd` | 세션 시작 / 종료 |
| `Stop` / `SubagentStop` | 응답이 끝날 때 |
| `Notification` / `PreCompact` | 알림 발생 / 컨텍스트 압축 직전 |

내가 만든 건 이 중 `PreToolUse`다. 툴이 실행되기 "직전"에 끼어들어서 판단하고, 마음에 안 들면 그 툴 실행을 취소시킬 수 있는 유일한 자리이기 때문이다.

## 실제로 만든 가드 hook

목표는 명확했다. Claude가 `git push`를 하려는 순간, 지금 활성 계정이 개인 계정(`bu-mang`)이 맞는지 확인하고, 아니면 막는 것이다. 덤으로 셸에 회사 토큰이 깔려 있는 경우도 막는다. 그 토큰이 계정 설정을 이겨버리니까.

먼저 `settings.json`에 hook을 등록한다. `PreToolUse`에 `Bash` 툴을 매처(matcher)로 걸었다.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/guard-bumang-push.js\""
          }
        ]
      }
    ]
  }
}
```

이렇게 하면 Claude가 Bash 툴을 부를 때마다 저 노드 스크립트가 실행된다. `git push`든 `ls`든 일단 실행되고, "git push인지 아닌지"는 스크립트 안에서 판단한다. 스크립트의 핵심은 이렇게 생겼다.

```js
const { execSync } = require('child_process');

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let cmd = '';
  try {
    cmd = (JSON.parse(raw).tool_input || {}).command || '';
  } catch {
    process.exit(0); // 파싱 실패 시 방해하지 않음
  }

  // git push가 아니면 통과. commit -m "...push..." 같은 오탐은 피한다.
  const isPush = /(^|[;&|]\s*)git\s+(-C\s+\S+\s+)?push(\s|$|[;&|])/.test(cmd);
  if (!isPush) process.exit(0);

  // 1) 셸에 회사 토큰이 있으면 그게 우선순위라 회사 계정으로 push → 차단
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
    console.error('❌ git push 차단: 셸에 GITHUB_TOKEN이 있어 회사 토큰으로 push→403 위험.');
    process.exit(2);
  }

  // 2) gh 활성 계정이 bu-mang인지 확인
  let active = '';
  try {
    const out = execSync('gh auth status 2>&1', { encoding: 'utf8' });
    // ...출력을 파싱해서 활성 계정 이름을 뽑는다...
  } catch {}

  if (active !== 'bu-mang') {
    console.error(`❌ git push 차단: gh 활성 계정이 '${active}'입니다. bu-mang으로 전환 후 재시도하세요.`);
    process.exit(2);
  }

  process.exit(0); // 통과
});
```

코드를 이루는 조각들을 뜯어보면 hook이 하네스와 어떻게 대화하는지가 보인다. `require('child_process')`로 불러온 `execSync`는 노드 안에서 또 다른 CLI 명령을 동기로 실행하고 그 출력을 문자열로 받는 함수다. 여기선 `gh auth status`를 돌려서 지금 활성 계정이 누구인지 알아내는 데 쓴다. hook이 단순히 들어온 데이터만 보는 게 아니라, 필요하면 이렇게 바깥 세계의 상태까지 조회해서 판단할 수 있다는 점이 핵심이다.

`process`는 실행 중인 이 노드 프로세스 자신을 가리키는 전역 객체다. hook이 하네스와 주고받는 모든 통로가 이 `process`를 거친다. `process.stdin`으로 tool call JSON을 받고, `process.env`로 환경변수(회사 토큰이 깔려 있는지)를 확인하고, `console.error`로 차단 사유를 stderr에 쓰고, `process.exit`로 최종 판단을 종료코드에 담는다. stdin은 스트림이라 데이터가 조각으로 도착하기 때문에, `data` 이벤트로 조각을 모으고 `end` 이벤트에서 한 번에 파싱하는 패턴을 쓴다.

## 설계하면서 배운 것들

만들고 테스트하는 과정에서 몇 가지가 손에 잡혔다.

가장 먼저, **최소 개입 원칙**이다. 이 hook은 모든 Bash 툴 호출마다 실행되지만, `git push`가 아니면 아무것도 하지 않고 즉시 `exit 0`으로 빠진다. hook이 매 명령에 끼어드는 만큼, 자기 일이 아닐 때는 최대한 빨리 손을 떼야 한다. 그렇지 않으면 모든 명령이 느려지고 예상치 못한 곳에서 막힌다.

두 번째는 **오탐을 피하는 것**이다. 처음엔 명령 문자열에 "push"가 들어가면 잡으려 했는데, 그러면 `git commit -m "add push button"` 같은 커밋 메시지까지 걸려버린다. 그래서 정규식을 "git 다음에 (선택적 -C 옵션을 거쳐) push가 서브커맨드로 오는 경우"로 좁혔다. 안전장치가 엉뚱한 걸 막으면 그때부터는 안전장치가 아니라 방해물이다.

세 번째는 **차단의 방향을 안전한 쪽으로 두는 것**이다. 이 가드가 없어도 사실 잘못된 계정으로 push하면 어차피 403으로 막힌다. 그러니 최악의 경우가 "실수로 막힘"이지 "실수로 잘못 나감"이 아니다. 판단이 애매할 땐 통과가 아니라 차단으로 기운다. 안전장치는 거짓 양성(막지 말아야 할 걸 막음)이 거짓 음성(막아야 할 걸 놓침)보다 낫다.

그리고 스코프. hook은 `settings.json`에서 오는데, Claude Code는 이 설정을 **실행된 프로젝트 루트의 `.claude/settings.json`과 유저 홈의 `~/.claude/settings.json`을 병합**해서 읽는다. 상위나 하위 폴더의 settings.json은 긁어오지 않는다. 그래서 이 가드를 프로젝트에 두면 이 레포를 열고 작업할 때만 켜지고, 전역에 두면 모든 세션에서 켜진다. push 실수를 이 레포에 한정하고 싶었으니 프로젝트 스코프가 맞았다.

## Skill과 Hook을 엮는다

이 레포에는 hook 말고 skill도 하나 만들어 뒀다. `deploy-bumang`이라는 skill인데, 계정을 개인 것으로 전환하고, 세 레포 중 커밋이 있는 것만 push하고, 다시 회사 계정으로 복귀하는 흐름 전체를 담고 있다. 여기서 skill과 hook의 성격 차이가 선명하게 드러난다.

**skill은 모델이 부르는 지식이고, hook은 이벤트가 실행하는 코드다.** skill은 Claude가 상황을 보고 "지금 이걸 쓰는 게 맞겠다"고 판단해서 컨텍스트로 끌어오는 지시문 뭉치다. 반면 hook은 Claude의 의사와 무관하게, 정해진 이벤트에 하네스가 결정론적으로 실행한다. 하나는 판단이고 하나는 규칙이다.

| | Skill | Hook |
|---|---|---|
| 실체 | 지시문/지식 (마크다운) | 실행 가능한 명령 (코드) |
| 트리거 | 모델이 판단해서 로드 | 이벤트에서 하네스가 자동 실행 |
| 성격 | 이렇게 하면 된다는 안내 | 이건 안 된다는 강제 |

둘을 엮으면 역할 분담이 자연스럽다. **skill이 정상 경로(happy path)를 자동화하고, hook이 안전망을 친다.** `deploy-bumang` skill은 "계정 전환 → push → 복귀"의 올바른 절차를 밟는다. 그리고 push 가드 hook은, 혹시 그 절차를 건너뛰고 잘못된 계정으로 push가 나가려 하면 막는다. skill이 잘 작동하면 hook은 조용히 통과만 하고, skill을 안 쓰고 손으로 하다가 실수하면 hook이 잡는다.

재미있는 건 이 둘이 서로를 전혀 모른다는 점이다. hook은 "deploy-bumang"이라는 skill이 있는지도 모르고, 그냥 push 시점의 계정만 본다. skill도 자기 push가 hook의 검사를 받는다는 걸 명시적으로 알지 못한다. 둘이 잘 맞물리는 건 연결 고리가 있어서가 아니라, **skill이 hook을 통과할 조건(개인 계정으로 먼저 전환)을 절차상 스스로 만족시키기 때문**이다.

이 지점에서 한 번 넘어졌다. `PreToolUse` hook은 명령이 **실행되기 전**에 계정을 확인한다. 그런데 skill 절차를 `gh auth switch --user bu-mang && git push`처럼 한 줄로 묶어 실행하면, hook은 switch가 실행되기 전, 즉 아직 회사 계정인 상태를 보고 자기 push를 막아버린다. 그래서 skill 문서에 "전환과 push는 반드시 별도의 명령으로 나눠 실행하라"고 못을 박았다. 전환을 먼저 끝내고, 그다음 별도 호출로 push해야 hook이 개인 계정 상태를 보고 통과시킨다. skill과 hook을 함께 쓸 때는 이런 실행 순서의 결합을 신경 써야 한다.

## 정리

이번 일로 Claude Code의 확장 구조가 조금 더 선명해졌다. Claude Code의 본체는 모델과 툴과 하네스가 도는 에이전트 루프이고, skill과 hook은 그 루프를 건드리지 않고 조율하는 서로 다른 창구다.

- **skill은 모델이 부른다.** Claude가 판단해서 컨텍스트로 끌어오는 지식이다. "이렇게 하면 된다"를 담는다.
- **hook은 이벤트가 부른다.** 하네스가 정해진 시점에 실행하는 코드다. "이건 안 된다"를 강제한다.
- **둘을 엮으면** skill이 정상 경로를 자동화하고 hook이 안전망을 친다. 서로를 몰라도, 조건을 통해 맞물린다.

작은 push 실수 하나를 막으려고 시작한 일인데, 덕분에 "판단으로 될 일과 규칙으로 강제해야 할 일"을 어떻게 나눌지 감이 잡혔다. 자동화는 대개 이 두 층으로 갈린다. 잘 되게 만드는 층과, 잘못돼도 안전하게 막는 층. skill과 hook은 딱 그 두 층에 하나씩 대응한다.

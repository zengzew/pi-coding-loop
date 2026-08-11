# V1 Architecture & Roadmap

> Role: design background and future roadmap only. This document is not an implementation source of truth. For V1 implementation decisions and conflict resolution, use `V1 Implementation-Ready Spec.md` exclusively.

## Original design document: Pi Coding Loop V1 落地方案

> 状态：V1 冻结方案  
> Coder：DeepSeek API  
> Reviewer：Kimi API  
> Runtime：Pi Agent SDK  
> 编排：薄 TypeScript Orchestrator  
> Verifier：真实 `lint / typecheck / test / build`

---

## 1. V1 目标

V1 只验证一个核心假设：

> **使用低成本 DeepSeek 负责高频 Coding，使用 Kimi 负责低频独立 Review，再通过真实环境 Verifier 提供客观反馈，能否形成稳定、可控、成本合理的 Coding Loop。**

输入一个明确的 Coding Task，例如：

```text
Implement WP-M2-07 according to docs/WP-M2-07.md
```

系统自动执行：

```text
Task
  ↓
DeepSeek Coder
  ↓
Deterministic Verifier
lint / typecheck / test / build
  ↓
失败 ─────────────→ DeepSeek 修复
  ↓ pass
Kimi Reviewer
  ↓
有 blocker ───────→ DeepSeek 修复
  ↓
Verifier
  ↓
Kimi Review
  ↓
DONE
```

核心原则：

> **Coder 无权决定 DONE。只有 Harness 根据真实验证结果和 Reviewer 结论决定任务是否完成。**

---

## 2. V1 架构

```text
                ┌─────────────────────┐
                │        Task         │
                └──────────┬──────────┘
                           ↓
                ┌─────────────────────┐
                │   DeepSeek Coder    │
                │    Pi Session A     │
                └──────────┬──────────┘
                           ↓
                ┌─────────────────────┐
                │ Deterministic       │
                │ Verifier            │
                │ test/lint/build     │
                └──────────┬──────────┘
                           ↓
                      passed?
                    /         \
                  no           yes
                  ↓             ↓
          feedback to      ┌─────────────────┐
          DeepSeek         │ Kimi Reviewer   │
                  ↑        │ Pi Session B    │
                  │        └────────┬────────┘
                  │                 ↓
                  │             blockers?
                  │            /          \
                  └──────── yes            no
                                           ↓
                                          DONE
```

---

## 3. 组件职责

### Pi Agent SDK

Pi 负责 Agent Runtime：

- Agent session
- context / trajectory
- model/provider integration
- `read / write / edit / bash`
- tool loop
- session persistence
- token / usage 信息
- compaction

Pi 不负责决定整个 Coding Loop 怎么走。

### Thin TypeScript Orchestrator

自定义代码只负责：

- routing
- iteration
- retry
- stop conditions
- feedback injection
- structured review
- telemetry
- cost budget
- DONE / STOPPED 判定

推荐边界：

```text
Pi = Agent Runtime
Your TypeScript = Loop Policy
```

### DeepSeek API

角色：Coder / Proposer。

负责：

- 阅读需求
- 探索 repo
- 修改代码
- 添加或更新测试
- 根据 verifier failure 修复
- 根据 Kimi blocker 修复

DeepSeek 是高频调用方。

### Deterministic Verifier

不使用 LLM。

负责执行真实：

```text
lint
typecheck
unit tests
integration tests
build
```

Verifier 是整个 Loop 中最重要的客观反馈源。

### Kimi API

角色：Independent Reviewer。

负责判断确定性工具无法完全判断的问题：

- 是否真正满足 requirements
- 是否遗漏重要 edge case
- 是否产生 regression
- 测试是否真的覆盖需求
- 是否存在错误假设
- 是否存在值得再迭代一次的重大 maintainability issue

Kimi 不直接修改代码。

---

## 4. 推荐目录

```text
pi-coding-loop/
├── src/
│   ├── cli.ts
│   ├── loop.ts
│   ├── coder.ts
│   ├── reviewer.ts
│   ├── verifier.ts
│   ├── state.ts
│   ├── config.ts
│   └── telemetry.ts
├── prompts/
│   ├── coder.md
│   └── reviewer.md
├── schemas/
│   └── review.ts
├── .pi-loop/
│   └── runs/
├── pi-loop.config.ts
├── package.json
└── README.md
```

V1 不需要 LangGraph、数据库或 Web UI。

---

## 5. 模型配置

配置不要写死在业务逻辑里：

```yaml
coder:
  provider: deepseek
  model: ${DEEPSEEK_CODER_MODEL}

reviewer:
  provider: kimi
  model: ${KIMI_REVIEWER_MODEL}

limits:
  max_coder_iterations: 4
  max_review_cycles: 2
  same_failure_limit: 3
  max_task_minutes: 30
```

环境变量：

```text
DEEPSEEK_API_KEY=...
KIMI_API_KEY=...
DEEPSEEK_CODER_MODEL=...
KIMI_REVIEWER_MODEL=...
```

这样以后切换模型只改配置，不修改 Loop。

---

## 6. Coder Session

DeepSeek Coder 使用 Pi Session A。

权限：

```text
read
write
edit
bash
```

同一个 Task 尽量复用同一个 Coder Session，使其持续保留：

```text
requirements
+ previous changes
+ verifier failures
+ reviewer feedback
```

### Coder Prompt

```text
You are the implementation agent.

Your responsibility is to implement the supplied task in the current repository.

Rules:
- Inspect the repository before changing code.
- Implement the smallest complete solution satisfying the requirements.
- Follow existing project conventions.
- Do not weaken tests or validation merely to make checks pass.
- Do not make unrelated changes.
- Treat verifier and reviewer feedback as evidence to investigate, not instructions to blindly follow.
- Preserve already-correct behaviour when fixing failures.
- You do not decide when the task is complete. The external harness decides completion.

When feedback is provided:
- identify the root cause;
- make the smallest correct change;
- preserve already-correct behaviour.
```

---

## 7. Verifier

建议配置：

```typescript
verification: [
  "npm run lint",
  "npm run typecheck",
  "npm test",
  "npm run build"
]
```

不同 repo 可以配置不同 command。

Verifier 输出：

```typescript
type VerificationResult = {
  passed: boolean;
  checks: {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  }[];
};
```

失败反馈直接来自真实命令：

```text
Verification failed.

Command:
npm test

Actual output:
...

Investigate the root cause and fix it.
Do not weaken valid tests merely to make verification pass.
```

不要使用：

```text
Please review your code again.
```

这种没有新信息的反馈。

---

## 8. Kimi Reviewer

Kimi 使用独立 Pi Session B。

推荐权限：

```text
read
```

必要时允许只读 Git 命令。

禁止：

```text
write
edit
```

Reviewer 输入：

```text
Task requirements
+
git diff
+
changed files
+
verification results
+
relevant repository context
```

不要把 DeepSeek 的完整 reasoning history 传给 Kimi。

Reviewer 应基于最终产物和真实验证结果建立独立判断。

### Reviewer Prompt

```text
You are an independent code reviewer.

You did not implement this change.

Review the implementation against the supplied requirements.

Focus on:
- requirement violations;
- correctness bugs;
- regressions;
- missing important edge cases;
- unsafe or invalid assumptions;
- tests that do not actually validate the required behaviour;
- materially harmful maintainability issues.

Do not request stylistic changes unless they materially affect correctness or maintainability.

Only report issues that justify another coding iteration.

Return a structured review result.
```

---

## 9. Reviewer 输出 Schema

Reviewer 必须返回结构化结果：

```typescript
type ReviewResult = {
  decision: "approve" | "changes_requested";

  blockers: {
    id: string;
    file?: string;
    line?: number;
    issue: string;
    evidence: string;
    suggestedFix?: string;
  }[];

  notes: string[];
};
```

Loop Router 只读取：

```text
decision
blockers
```

不要解析诸如：

```text
Overall this looks good, but maybe...
```

这样的自然语言来决定路由。

---

## 10. Routing

V1 使用普通 TypeScript 状态机。

```text
START
  ↓
CODER
  ↓
VERIFY
```

如果 verifier failed：

```text
VERIFY
  ↓
CODER
```

如果 verifier passed：

```text
VERIFY
  ↓
REVIEW
```

如果：

```text
review.decision = changes_requested
```

则：

```text
REVIEW
  ↓
CODER
  ↓
VERIFY
  ↓
REVIEW
```

只有：

```text
verification.passed == true
AND
review.decision == approve
```

才进入：

```text
DONE
```

---

## 11. Loop 伪代码

```typescript
while (true) {
  await coder.run({
    task,
    feedback: state.feedback,
  });

  state.coderIteration++;

  const verification = await verifier.run();
  state.verification = verification;

  if (!verification.passed) {
    state.feedback = buildVerificationFeedback(verification);

    if (shouldStop(state)) {
      return stop(state);
    }

    continue;
  }

  const review = await reviewer.run({
    task,
    diff: await getGitDiff(),
    verification,
  });

  state.reviewCycle++;
  state.review = review;

  if (review.decision === "approve") {
    return done(state);
  }

  state.feedback = review.blockers;

  if (shouldStop(state)) {
    return stop(state);
  }
}
```

---

## 12. Stop Conditions

V1 默认：

```text
maxCoderIterations = 4
maxReviewCycles = 2
sameFailureLimit = 3
maxTaskMinutes = 30
```

### DONE

```text
Verifier passed
AND
Kimi approved
```

### STOPPED

任一满足：

```text
max coder iterations reached
max review cycles reached
same failure repeated >= 3
task timeout reached
required access unavailable
unrecoverable environment failure
```

V1 不做无限重试。

---

## 13. State

不使用数据库。

```typescript
type LoopState = {
  runId: string;
  task: string;

  status:
    | "coding"
    | "verifying"
    | "reviewing"
    | "done"
    | "stopped";

  coderIteration: number;
  reviewCycle: number;

  feedback: unknown[];

  verification?: VerificationResult;
  review?: ReviewResult;

  lastFailureSignature?: string;
  repeatedFailureCount: number;

  startedAt: string;
  finishedAt?: string;
};
```

本地保存：

```text
.pi-loop/
└── runs/
    └── <run-id>/
        ├── state.json
        ├── events.jsonl
        ├── verification-01.json
        ├── review-01.json
        └── final-report.md
```

---

## 14. Telemetry

必须从 V1 开始记录。

### Coder

```text
model
calls
input tokens
output tokens
cache tokens
estimated cost
```

### Reviewer

```text
model
calls
input tokens
output tokens
cache tokens
estimated cost
```

### Loop

```text
coder iterations
review cycles
verifier failures
repeated failures
duration
final status
```

最终报告：

```text
Task: <task>
Status: DONE

Coder:
  model: DeepSeek
  iterations: 3
  cost: $...

Reviewer:
  model: Kimi
  reviews: 1
  cost: $...

Verification:
  lint: pass
  typecheck: pass
  tests: pass
  build: pass

Duration:
  12m 43s
```

---

## 15. Git 和安全边界

V1：

```text
trusted repository
+ clean working tree
+ dedicated branch/worktree
+ human starts the run
+ no production credentials
```

禁止：

```text
auto merge
auto push
auto deploy
auto release
production mutation
```

Agent 最终只留下：

```text
working tree / branch
+
final report
```

由人决定后续操作。

---

## 16. V1 明确不做

V1 不做：

- LangGraph
- server deployment
- Pi Web
- mobile remote control
- Docker sandbox
- planner agent
- multiple reviewers
- dynamic DAG
- auto PR / merge / deploy
- long-term memory
- complex model routing
- browser / visual verification
- GPT / Codex fallback
- autonomous task discovery

V1 只做：

```text
DeepSeek
→ Verifier
→ Kimi
→ Feedback
→ DeepSeek
```

---

## 17. V1 验收标准

CLI：

```bash
pi-loop run task.md
```

一次运行必须能够：

1. DeepSeek 理解任务并修改 repo。
2. 自动运行真实 verifier。
3. verifier 失败后自动反馈给 DeepSeek。
4. DeepSeek 根据真实错误继续修复。
5. verifier 全通过后才调用 Kimi。
6. Kimi 使用独立 context Review。
7. Kimi blocker 自动反馈给 DeepSeek。
8. 修复后必须重新经过 verifier。
9. Kimi approve 后才进入 DONE。
10. 达到限制后进入 STOPPED。
11. 输出 token、cost、iteration、duration telemetry。
12. 全程不需要人工复制粘贴模型输出。

满足以上条件，V1 即完成。

---

# 18. 后续迭代路径

## V1.1 — Evaluation First

V1 跑通后，不要马上增加更多 Agent。

先准备 10～20 个真实 Coding Task：

```text
bug fix
small feature
refactor
test addition
cross-file change
```

记录：

```text
success rate
cost / task
duration / task
coder iterations
review cycles
human correction rate
```

目标：

> 证明 Loop 本身有价值。

---

## V1.2 — Ablation

比较至少三组：

```text
A. DeepSeek only

B. DeepSeek + Verifier

C. DeepSeek + Verifier + Kimi Reviewer
```

比较：

```text
task success rate
cost per successful task
regression rate
human intervention
iterations
```

这一阶段回答最重要的问题：

> Kimi Reviewer 到底增加了多少质量，又增加了多少成本？

---

## V1.3 — Reliability

再增加：

```text
automatic git worktree
crash resume
command timeout
process cleanup
failure signature
events.jsonl
state recovery
```

目标：

> 从“能跑”升级成“无人值守也不会轻易跑坏”。

---

## V1.4 — Sandbox

加入 Docker / VM 隔离。

```text
Task
↓
temporary worktree
↓
sandbox
↓
Pi Loop
```

隔离：

```text
filesystem
credentials
network
processes
```

这时才更适合长时间无人值守执行。

---

## V1.5 — Cost Optimization

根据 V1.1 / V1.2 数据做成本优化：

```text
Verifier failed
→ 不调用 Kimi

Only after verifier passes
→ Kimi review
```

进一步优化 Reviewer Context：

```text
requirements
+ git diff
+ relevant files
+ verifier summary
```

避免把整个 repo 无差别传给 Reviewer。

加入：

```text
max_cost_per_task
max_reviewer_tokens
max_coder_tokens
```

---

## V1.6 — Model Escalation

只有数据证明 DeepSeek 在某些任务持续失败时才增加升级模型：

```text
DeepSeek
↓
same blocker × N
↓
stronger coder
```

此时可以实验：

```text
DeepSeek → GPT / Codex
```

但不进入 V1 初版。

---

## V1.7 — Remote Agent Machine

当 Coding Loop 已稳定，再迁移到常开机器：

```text
Always-on machine
├── Git repos
├── Pi
├── pi-loop
├── sandbox
└── remote UI
```

远程访问：

```text
iPhone
↓
Tailscale
↓
Pi Web / remote UI
↓
Agent Machine
```

这样手机只是控制面，真正代码和工具都在远程机器执行。

---

## V1.8 — Visual / Browser Verification

仅 UI / Web 项目需要时增加：

```text
Coder
↓
build
↓
launch app
↓
browser automation
↓
screenshot
↓
visual review
```

核心仍然是：

> Reviewer 获得新的真实观察，而不是重新读一遍相同代码。

---

## V1.9 — Human Approval

高风险操作增加人工门控：

```text
dependency upgrade
database migration
security-sensitive change
large deletion
external side effect
```

流程：

```text
Agent proposes
↓
Harness detects high risk
↓
Human approval
↓
Execute
```

---

## V2 — Graph Engineering

只有当真实系统出现以下需求时再考虑 LangGraph 或其他 Graph Orchestrator：

```text
multiple branches
parallel reviewers
human interrupt
durable checkpoint
long-running task
external events
fan-out / fan-in
```

届时可能演进为：

```text
                 ┌→ Security Review
Coder → Verify ──┼→ Visual Review
                 ├→ API Review
                 └→ Architecture Review
                         ↓
                     Aggregate
                         ↓
                   Fix / Approve
```

Graph 是复杂 Loop 的编排层，而不是 V1 的前置条件。

---

# 19. 推荐实际开发顺序

不要一次写完整 V1。

按以下顺序实现：

```text
Step 1
Pi + DeepSeek 能修改测试 repo

Step 2
加入 deterministic verifier

Step 3
verifier failure 自动反馈同一 Coder Session

Step 4
加入 Kimi read-only Reviewer

Step 5
Reviewer 输出结构化 blocker

Step 6
blocker 自动反馈 DeepSeek

Step 7
加入 DONE / STOPPED

Step 8
加入 telemetry

Step 9
用 5～10 个真实 task 试跑

Step 10
进入 Evaluation / Ablation
```

---

# 20. 三条不可破坏的原则

### 1. Verifier 优先于 Reviewer

能真实执行，就不要让 LLM 猜：

```text
能否编译
→ build

测试是否通过
→ test

类型是否正确
→ typecheck
```

### 2. Kimi 只做高价值判断

Kimi 不负责：

```text
lint
format
compile
basic test execution
```

Kimi 负责：

```text
requirement correctness
edge cases
regression
test quality
important design flaws
```

### 3. 每轮必须注入新信息

好的 Loop：

```text
change
→ real test
→ new failure
→ fix
```

或者：

```text
change
→ new diff
→ independent Kimi review
→ new blocker
→ fix
```

坏的 Loop：

```text
write
→ think again
→ review again
→ optimize again
```

没有新观察的循环容易空转。

---

# 21. V1 一句话定义

```text
DeepSeek 负责高频 Coding
+
真实 Verifier 负责客观反馈
+
Kimi 负责低频独立 Review
+
Pi 负责 Coding Agent Runtime
+
一个极薄的 TypeScript 状态机负责 Loop Policy
```

后续演进顺序：

```text
跑通
→ Evaluation
→ Ablation
→ Reliability
→ Sandbox
→ Cost Optimization
→ Model Escalation
→ Remote
→ Rich Verification
→ Graph
```

不要反过来。

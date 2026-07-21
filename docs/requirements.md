# Interjector — 需求文档

## 1. 项目背景

Interjector 是一个实时语音辅助 Web 应用，能在用户收听对话时同步进行语音转写、翻译，并调用 LLM 生成辅助内容（如回复建议、幽默插话、背景知识补充等）。项目创建于 2024 年，目前处于早期可用状态，存在若干架构缺陷和未完成功能，需要系统性优化重构。

---

## 2. 当前架构概览

> 注：下方为重构 **前** 的原始结构，保留作为背景。重构后的实际结构见 §10。

```
interjector/
├── backend/src/
│   ├── server.ts          # 手写 HTTP/HTTPS 服务器 + 路由
│   ├── translation-api.ts # 翻译后端适配器
│   ├── completion-api.ts  # 【空文件】补全后端（未实现）
│   └── mimes.ts           # MIME 类型表
└── frontend/src/
    ├── main.ts                       # 主协调类 Interjector
    ├── SpeechRecognitionController.ts # Web Speech API 封装
    ├── ResultManager.ts              # DOM 渲染管理
    └── ConsolePanel.ts               # 控制面板事件管理
```

**技术栈**：TypeScript + esbuild（无前端框架，无后端框架，无测试）

---

## 3. 现有功能

| 功能 | 状态 |
|------|------|
| 语音实时转写（最终结果 + 进行中结果） | ✅ 可用 |
| 翻译代理（经后端转发） | ✅ 可用（仅 `free-google-translate` 和 `openai-translate`） |
| LLM 补全（流式，直接从浏览器调用） | ✅ 可用（OpenAI 风格 + Gemini） |
| 设置页（`localStorage` 持久化） | ✅ 可用 |
| HTTPS 支持（含内置自签名证书） | ✅ 可用 |

---

## 4. 已知问题与缺陷

### 4.1 功能缺陷

1. **语音识别仅支持 Chrome**  
   `SpeechRecognitionController` 硬编码使用 `window['webkitSpeechRecognition']`，其他浏览器不可用。非英语语言识别效果差。没有抽象接口，无法接入第三方识别服务。

2. **多个翻译后端未实现**  
   `google-translate`、`bing-translate`、`deepl-translate` 均返回 `NOT_IMPLEMENTED`，对用户可见但不可用。

3. **`/api/complete` 后端接口未实现**  
   后端路由直接返回 `{ message: 'NOT_IMPLEMENTED' }`，补全逻辑完全在前端绕过后端直接调用 LLM API。

4. **`completion-api.ts` 是空文件**  
   无法扩展或复用服务端补全逻辑。

5. **无法中止进行中的补全**  
   `completeTranscript()` 中创建了 `AbortController` 但从未调用 `.abort()`，无取消机制。

### 4.2 安全问题

6. **API 密钥前端可见（已知风险，设计决策见 §5.1）**  
   补全（Completion）的 API Key 由前端直接携带发送给第三方 LLM API，用户需知晓此风险。重构后将提供后端兜底 Key 机制（用户未填时由服务端代填）。

7. **API 密钥明文存储于 `localStorage`**  
   所有配置（含 API Key）以 JSON 明文形式存入 `localStorage`，无加密保护（此为自托管工具的可接受设计，但应在 UI 上提示用户）。

8. **XSS 漏洞**  
   `ResultManager.addFinalTranscript()` 和 `setOnGoingTranscript()` 使用 `innerHTML +=` 直接注入未经转义的转写文本，若语音识别返回含 HTML 标签的字符串（或恶意注入）则存在 XSS 风险。

9. **翻译请求无输入校验**  
   `server.ts` 中 `/api/translate` 接收用户传来的 `backend` 字段后直接作为对象 key 访问，未校验是否为合法枚举值，可能引发意外行为（`translationAPI[undefined]` 等）。

10. **内置自签名证书打包进代码**  
    `fake.cert.txt` 和 `fake.key.txt` 直接 import 进 bundle，不应出现在生产代码中。

### 4.3 代码质量问题

11. **前端直接操作 DOM 字符串拼接**  
    `main.ts` 中手动拼接 `<div class="transcript-item not-final">` 等 HTML 字符串，逻辑与视图耦合。

12. **`server.ts` 中重复调用 `JSON.parse(payload)`**  
    `/api/translate` 处理函数末尾多余地调用了一次 `JSON.parse(payload)`（第 60 行），结果被丢弃。

13. **`ConsolePanel.activeClearBtn()` 逻辑反转**  
    方法名为 `activeClearBtn` 但实现为 `clearBtnDom.disabled = true`，语义相反。

14. **`onGoingTranscript` 未在构造函数中初始化**  
    `Interjector` 类中 `onGoingTranscript` 声明为 `string` 但未赋初值，首次访问为 `undefined`。

15. **`settings.html` 使用内联 `<script>` 且无 TypeScript 类型检查**  
    设置页逻辑无类型保护，与主 TypeScript 体系脱离。

16. **无任何测试**  
    `package.json` 中 `test` 脚本仅输出错误并退出。

17. **手写路由系统结构混乱**  
    `server.ts` 的递归路由分发逻辑繁琐，嵌套对象路由难以阅读和维护，但保留原生 `http`/`https` 模块即可，无需引入外部框架。

---

## 5. 重构目标

### 5.1 核心设计决策

**D-01 API Key 管理**：采用"用户自带 Key + 后端兜底"模式。
- 用户可在设置页填入自己的 API Key，前端直接携带调用第三方 API（用户自行承担 Key 暴露风险）。
- 若用户未填写 Key，则请求路由到后端，由后端使用服务器管理员预配置的 Key 代为调用。
- 后端不记录、不收集用户填写的 Key。

**D-02 语音识别抽象**：不绑定任何具体服务（含 Whisper），改为定义通用 `SpeechRecognitionProvider` 接口，Web Speech API 作为内置实现，第三方服务通过 wrapper 实现同一接口接入。

**D-04 不引入额外框架**：前后端均保持当前技术栈（原生 Node.js `http`/`https` + TypeScript + esbuild），不引入任何前端 UI 框架或后端 Web 框架。前端遵循"DOM 即状态"（DOM as state）原则：DOM 元素本身即为应用状态的唯一来源，业务逻辑直接读写 DOM，不维护额外的镜像状态变量。

### 5.2 核心目标

1. 修复 XSS 漏洞
2. 实现 API Key 双模式（用户自带 / 后端兜底）
3. 重构语音识别为通用 Provider 接口
4. 重构翻译模块为通用 Provider 接口
5. 补全未实现的翻译后端

### 5.3 架构目标

6. 后端路由重构为平铺、可读的结构，保留原生 `http`/`https` 模块，不引入框架
7. 前端遵循 DOM as state 原则重构 `ResultManager`：以 DOM 查询替代内部状态字段，消除冗余镜像变量
8. 补全测试覆盖（单元测试 + 集成测试）
9. 将设置页迁移为 TypeScript 模块

### 5.4 用户体验目标

10. 补全进行中支持中止
11. 增加加载状态与错误提示
12. 支持多语言 UI

---

## 6. 功能需求（重构后）

### F-01 语音识别

定义通用 `SpeechRecognitionProvider` 接口，内置 Web Speech API 实现，第三方服务通过 wrapper 接入。

```typescript
interface SpeechRecognitionProvider {
  setLang(lang: string): void;
  start(): void;
  stop(): void;
  on(event: 'result', handler: (result: RecognitionResult) => void): void;
  on(event: 'start' | 'end' | 'error', handler: () => void): void;
}

interface RecognitionResult {
  transcript: string;
  isFinal: boolean;
  confidence?: number;
}
```

- **F-01-1** 内置 `WebSpeechProvider`，封装 `webkitSpeechRecognition`
- **F-01-2** 允许通过配置注册自定义 Provider（e.g. 基于 WebSocket 推流的第三方 ASR 服务 wrapper）
- **F-01-3** 支持配置识别语言（BCP 47）
- **F-01-4** 同时展示"进行中"和"已确认"两种转写状态；状态直接体现在 DOM 元素的 class 上（`final` / `not-final`），无需额外 JS 变量
- **F-01-5** Provider 切换不影响上层业务逻辑

### F-02 翻译

定义通用 `TranslationProvider` 接口，各翻译后端作为独立实现。

```typescript
interface TranslationProvider {
  translate(options: TranslateOptions): Promise<TranslationResult>;
}

interface TranslateOptions {
  text: string;
  sourceLang: string;
  targetLang: string;
  apiKey?: string;   // 用户自带 Key；未填则由后端兜底
}
```

- **F-02-1** 内置实现：`FreeGoogleTranslationProvider`、`OpenAITranslationProvider`
- **F-02-2** 可选实现：`GoogleTranslationProvider`、`BingTranslationProvider`、`DeepLTranslationProvider`
- **F-02-3** API Key 优先使用前端用户填写的值；未填时路由到后端，后端使用服务器预配置 Key 调用
- **F-02-4** 后端对 `backend` 字段进行严格枚举校验，拒绝非法值
- **F-02-5** 允许通过 wrapper 注册自定义翻译 Provider

### F-03 LLM 补全

- **F-03-1** API Key 优先使用前端用户填写的值（直接调用第三方 API）；未填时路由到后端兜底
- **F-03-2** 支持 OpenAI 风格流式响应（SSE/streaming）
- **F-03-3** 支持 Google Gemini 风格流式响应
- **F-03-4** 用户可随时中止补全（正确使用 `AbortController`）
- **F-03-5** 补全结果以追加方式展示，历史结果不被覆盖
- **F-03-6** 后端 `/api/complete` 接口实现完整（当前为空文件）

### F-UI DOM as State 原则

前端所有模块遵循以下约定，不引入任何 UI 框架：

- **F-UI-1** DOM 元素是状态的唯一来源。需要读取"当前转写内容"时，直接查询 DOM（`innerText`），不维护 JS 镜像变量。
- **F-UI-2** 禁止使用 `innerHTML` 注入用户数据（XSS 防护）；使用 `textContent`、`createElement` + `appendChild` 构建动态内容。
- **F-UI-3** 元素可见状态、激活状态通过 CSS class 切换表达（如 `active`、`final`、`not-final`），不用额外 boolean 字段跟踪。
- **F-UI-4** `ResultManager` 中私有 DOM 引用字段（`transcriptFinalDom` 等）保留，但读取内容时直接从 DOM 取值，删除所有冗余的 JS 状态副本（如当前 `onGoingTranscript` 字段）。

- **F-04-1** 设置页使用 TypeScript 模块，与主应用共享类型定义
- **F-04-2** API Key 存储于 `localStorage`（明文，属已知设计取舍，UI 上提示用户风险）
- **F-04-3** 配置字段需有基础校验（非空、URL 格式等）
- **F-04-4** 新增：Provider 类型选择下拉框（语音识别、翻译各自独立选择）

### F-05 安全

- **F-05-1** 所有 DOM 写入操作必须使用 `textContent` 或等价的安全方法，禁止 `innerHTML` 直接注入用户数据
- **F-05-2** 后端对所有输入进行类型与枚举校验后再处理
- **F-05-3** 内置自签名证书不得打包进生产 bundle
- **F-05-4** 后端兜底调用时，服务器 Key 仅在服务端环境变量中配置，不返回给前端

---

## 7. 非功能需求

| 类别 | 要求 |
|------|------|
| 浏览器兼容性 | Chrome（主要）；Firefox、Safari（通过自定义 Provider wrapper 接入第三方 ASR 服务支持） |
| 延迟 | 翻译端到端 < 3s（取决于 API）；补全首 token < 5s |
| 安全 | 满足 OWASP Top 10 基础防护 |
| 测试 | 核心逻辑单元测试覆盖率 ≥ 60% |
| 部署 | 支持 HTTP_ONLY 模式及反向代理（Nginx/Caddy）托管 SSL |

---

## 8. 不在本次范围内

- 用户账户系统 / 多用户支持
- 转写历史持久化（数据库）
- 移动端原生应用
- 离线模式

---

## 9. 优先级排序

| 优先级 | 任务 |
|--------|------|
| P0（阻塞） | 修复 XSS（F-05-1）；修复代码逻辑错误（§4.3） |
| P1（高） | 重构语音识别为通用 Provider 接口（F-01）；重构翻译为通用 Provider 接口（F-02）；API Key 双模式（D-01）；枚举校验（F-02-4）；内置证书移出 bundle（F-05-3） |
| P2（中） | 实现后端 `/api/complete` 兜底接口（F-03-6）；补全可中止（F-03-4）；设置页 TypeScript 化（F-04-1）；后端路由平铺重构 |
| P3（低） | 更多翻译后端（F-02-2 可选项）；测试 |

---

## 10. 重构后架构（已实现）

```
interjector/
├── tsconfig.json                 # 类型检查配置
├── scripts/gen-cert.sh           # 生成开发用自签名证书（不打包进 bundle）
├── shared/
│   └── stream-parser.ts          # 前后端共享的纯函数流解析器（可测试，避免 drift）
├── tests/                        # node:test 单元 + 集成测试
│   ├── translation-api.test.ts
│   ├── stream-parser.test.ts
│   └── server.integration.test.ts
├── .env / .env.example           # 全部配置（含密钥）从 .env 读取（node --env-file）
├── backend/src/
│   ├── server.ts                 # 嵌套对象路由（递归 route()，原版结构）+ /api/config + WS upgrade（配置来自 config.ts）
│   ├── config.ts                 # 服务端配置：从环境变量读取全部设置；publicConfig 只暴露非密钥
│   ├── translation-api.ts        # TranslationProvider 实现（5 个后端）
│   ├── completion-api.ts         # CompletionProvider（OpenAI + Gemini 流式）
│   ├── ws.ts                     # 手写 RFC 6455 WebSocket server（无 ws 依赖）
│   ├── asr-proxy.ts              # /api/asr WebSocket 代理 → Deepgram（Authorization 头鉴权，配置来自 .env）
│   ├── mimes.ts
│   └── @types/index.d.ts         # 后端共享类型 + Provider 接口
└── frontend/src/
    ├── main.ts                   # 主协调类（拉取 /api/config + 页面内音源选择 + interim 翻译防抖/中止）
    ├── config.ts                 # fetchConfig()：从 /api/config 拉取非密钥配置
    ├── translation.ts            # 翻译请求（只发 {text}，配置全在后端）
    ├── completion.ts             # 补全请求（只发 {text}，经后端 NDJSON 流 + AbortController）
    ├── ResultManager.ts          # DOM 渲染（textContent / DOM as state / 说话人标签）
    ├── ConsolePanel.ts           # 控制面板（补全/中止状态）
    ├── audio/
    │   └── AudioMixer.ts         # 多音源采集与混音（麦克风 + 系统/标签页输出 → 单一 MediaStream）
    ├── speech/
    │   └── DeepgramProvider.ts   # Deepgram 流式 ASR（经 /api/asr 代理；音源混音 + 角色识别标签）
    └── @types/index.d.ts         # 前端类型（PublicConfig / AudioSourceOptions / SpeechRecognitionProvider）

（另：frontend/public/pcm-worklet.js 为 AudioWorklet，将混音流转为 linear16 PCM）

说明：本轮重构移除了前端设置页（settings.html/ts）与 localStorage 配置，全部配置改为
服务端 .env；前端仅在页面内选择音源（麦克风/系统输出，需用户交互无法放进 .env）。
WebSpeechProvider / CustomWebSocketProvider 已移除，语音识别统一走 Deepgram + 后端代理。

路由：§5.3-6「路由平铺重构」经 review 撤回——保留原版嵌套对象 + 递归 `route()` 结构（更简单），
仅修复其客观 bug（去掉重复 `JSON.parse`、剥离 query string、统一错误处理、枚举校验下沉到
translation-api）。WebSocket 服务端 `ws.ts` 为手写 RFC 6455 实现：Node 无原生 WS 服务端
（`globalThis.WebSocket` 仅客户端），按「不引入运行时依赖」的约束手写，刻意未用 `ws` 库。
```

**技术栈**：TypeScript + esbuild；测试用内置 `node:test`（无外部框架，保持 D-04）。

### 10.1 实现状态对照

| 需求 | 状态 | 说明 |
|------|------|------|
| F-05-1 XSS 修复 | ✅ | `ResultManager` 全面改用 `textContent` / `createElement` / `replaceChildren` |
| §4.3 #12 重复 `JSON.parse` | ✅ | server 重写，已移除 |
| §4.3 #13 `activeClearBtn` 反转 | ✅ | 语义已修正（active=启用） |
| §4.3 #14 `onGoingTranscript` 未初始化 | ✅ | 删除镜像变量，改为 DOM as state（`getOnGoingTranscript()`） |
| F-01 语音识别 Provider 接口 | ✅ | `SpeechRecognitionProvider` + `WebSpeechProvider` + `DeepgramProvider` + 自定义 WS wrapper 示例 |
| F-01-x 多音源混音 | ✅ | `AudioMixer` 支持多麦克风 + 系统/标签页输出混音（`getUserMedia` + `getDisplayMedia` + Web Audio）；仅适用于流式 ASR provider，Web Speech API 受浏览器限制仅用默认麦克风 |
| F-01-x 多语言 + 角色识别 | ✅ | `DeepgramProvider`：`language=multi` 多语言/code-switching，`diarize=true` 角色识别，结果带 `speaker` 标签并在转写区渲染 |
| F-01-x ASR 后端代理 | ✅ | 浏览器经 `/api/asr` WebSocket 代理连 Deepgram；后端用 `Authorization` 头鉴权（全浏览器可用，修复 Firefox 子协议鉴权失败）；`DEEPGRAM_API_KEY` 在服务端，key 不暴露给前端 |
| F-02 翻译 Provider 接口 | ✅ | 5 个 `TranslationProvider` 实现 |
| F-02-2 可选翻译后端 | ✅ | google / bing / deepl 已实现（需对应 Key） |
| F-02-4 枚举校验 | ✅ | `isTranslationBackend` 严格校验，非法值返回 400 |
| D-01 API Key 双模式 | ✅ | 用户填 Key→直连；留空→经后端，后端用 `*_API_KEY` 环境变量兜底 |
| F-03-6 `/api/complete` | ✅ | 后端流式实现（OpenAI + Gemini），仅在用户未填 Key 时使用 |
| F-03-4 补全可中止 | ✅ | `AbortController` 贯穿前端 UI 与后端流（`req.on('close')`） |
| F-04-1 设置页 TS 化 | ✅ | `settings.ts`，与主应用共享类型 |
| F-04-3 / F-04-4 校验与 Provider 选择 | ✅ | 表单校验 + 语音/翻译 Provider 下拉框 |
| F-05-3 证书移出 bundle | ✅ | 删除 `fake.*.txt`；改为 `KEY_PATH`/`CERT_PATH` 或 `scripts/gen-cert.sh` |
| F-05-4 服务器 Key 不外泄 | ✅ | 仅从环境变量读取，不返回前端；兜底 Key 仅发送至白名单主机（`ALLOWED_API_HOSTS`），防 SSRF / Key 外泄 |
| 测试 ≥60% 核心逻辑 | ✅ | 21 个测试覆盖解析器、Provider 校验、配置、服务器路由/校验 |

### 10.2 部署相关环境变量

| 变量 | 说明 |
|------|------|
| `PORT` / `HOST` | 监听地址（默认 `8000` / `localhost`） |
| `HTTP_ONLY` | `true` 时仅用 HTTP（由反向代理处理 TLS） |
| `KEY_PATH` / `CERT_PATH` | HTTPS 模式下必填；不再有内置兜底证书 |
| `TRANSLATION_API_KEY` | 翻译后端兜底 Key（用户未填时使用） |
| `COMPLETION_API_KEY` | 补全后端兜底 Key（用户未填时使用） |
| `ALLOWED_API_HOSTS` | 兜底 Key 允许发送到的额外主机名（逗号分隔）。已知 provider 主机默认在白名单内；兜底 Key 不会被转发到非白名单主机（防 SSRF / Key 外泄） |

### 10.3 待办 / 后续

- F-04-2 已知取舍：Key 仍以明文存于 `localStorage`，已在设置页加风险提示。
- 非功能需求「多语言 UI」（§5.4-12）尚未实现，留作后续。
- `CustomWebSocketProvider` 为接入示例，具体音频编码/协议需按目标 ASR 服务适配。

# NGL Relay — DEX Class Surface

Generated from the preserved `kernel_dexdump.txt` for the DEX inside the byte-identical reference APK. This is static metadata: class names, embedded source filenames, and method signatures. It does not claim method-body decompilation.

## Application layer

### `ngl.relay.app.ArtifactActivity` (`ArtifactActivity.java`)
`app()`, `dp(int)`, `reopen(String)`, `shortLabel(Artifact,String)`, `onCreate(Bundle)`

### `ngl.relay.app.CaseActivity` (`CaseActivity.java`)
`app()`, `badgeFor(Artifact)`, `dp(int)`, `mkButton(String,Runnable)`, `refreshRecord()`, `runStage(int)`, `showHumanDialog(boolean)`, `stageSummary(int,List)`, `toast(String)`, `onCreate(Bundle)`, `onResume()`

### `ngl.relay.app.CompareActivity` (`CompareActivity.java`)
`app()`, `dp(int)`, `onCreate(Bundle)`

### `ngl.relay.app.MainActivity` (`MainActivity.java`)
`app()`, `dp(int)`, `handleShareIntent(Intent)`, `openCase(String)`, `refreshList()`, `toast(String)`, `onCreate(Bundle)`, `onNewIntent(Intent)`, `onResume()`

### `ngl.relay.app.NodeRegistry` (`NodeRegistry.java`)
`activeNodes(Context)`, `apiKey(Context,String)`, `baseUrl(Context,String)`, `contextBudgetChars(Context)`, `enabled(Context,String)`, `model(Context,String)`, `prefs(Context)`, `setApiKey(Context,String,String)`, `setBaseUrl(Context,String,String)`, `setContextBudgetChars(Context,int)`, `setEnabled(Context,String,boolean)`, `setModel(Context,String,String)`, `setTimeoutMillis(Context,int)`, `slotStates(Context)`, `timeoutMillis(Context)`

Nested types observed: `NodeRegistry.Slot`, `NodeRegistry.SlotState`; `SlotState.ready()` is present.

### `ngl.relay.app.RelayApp` (`RelayApp.java`)
`engine()`, `onCreate()`, `refreshEngine()`, `store()`

### `ngl.relay.app.SettingsActivity` (`SettingsActivity.java`)
`app()`, `dp(int)`, `nodePanel(NodeRegistry.Slot)`, `parseInt(String,int)`, `toast(String)`, `onCreate(Bundle)`

## Canonical artifact / storage layer

### `ngl.relay.core.Artifact` (`Artifact.java`)
`builder(String,Artifact.Type,int)`, `fromJson(String)`, `newId()`, `require(Object,String)`, `equals(Object)`, `hashCode()`, `toJson()`, `toString()`

Nested types observed: `Artifact.Builder`, `Artifact.Type`.

Builder methods observed: `content`, `contentType`, `createdAt`, `error`, `hash`, `id`, `model`, `nodeId`, `parent`, `parents`, `provider`, `status`, `build`.

### `ngl.relay.core.CaseStore` (`CaseStore.java`)
`caseDir(String)`, `copyFile(File,File)`, `defaultTitle(String)`, `delete(File)`, `mkdirs(File)`, `readFile(File)`, `readLines(File)`, `writeFile(File,String)`, `writeMeta(File,CaseMeta)`, `appendArtifact(File,Artifact)`, `appendArtifact(String,Artifact)`, `audit(String)`, `byStage(String,int)`, `byType(String,Artifact.Type)`, `children(String,String)`, `createCase(String,String)`, `getArtifact(String,String)`, `getMeta(String)`, `listArtifacts(String)`, `listCases()`, `maxStage(String)`, `recordLog(String)`, `updateMeta(CaseMeta)`

Nested `CaseStore.CaseMeta` has `fromJson(String)` and `toJson()`.

### `ngl.relay.core.ContextBuilder` (`ContextBuilder.java`)
`entryFor(Artifact,boolean)`, `isProtective(Artifact)`, `assemble(String,CaseStore,String,List,String)`

Nested type observed: `ContextBuilder.Assembled`.

### `ngl.relay.core.CoreJson` (`CoreJson.java`)
`parseArray(String)`, `parseObject(String)`, `sha256Hex(String)` plus JSON writer helpers.

Nested parser/object types expose typed getters, list/object accessors, key enumeration, and primitive parsing.

### `ngl.relay.core.Iso8601` (`Iso8601.java`)
`newFormat()`, `now()`, `of(long)`, `parse(String)`

## Methodology layer

### `ngl.relay.core.MethodologyEngine` (`MethodologyEngine.java`)
`accumulated(String,int,int)`, `appendRequestWithParents(...)`, `bumpStage(CaseMeta,int)`, `byStageType(String,int,Artifact.Type)`, `originalContent(String)`, `recordError(...)`, `addHumanAnnotation(String,String,List)`, `addHumanDecision(String,String,List)`, `childIndex(String)`, `fullRecord(String)`, `runStage1(String,List,Progress)`, `runStage2(String,List,Progress)`, `runStage3(String,List,Progress)`, `runStage4(String,List,Progress)`, `runStage5(String,List,Progress)`

Nested `Progress` interface methods: `onNodeStart(String,int)`, `onNodeDone(String,int,String)`, `onNodeError(String,int,String,String)`.

## Cognition / transport layer

### `ngl.relay.core.Node` (`Node.java`)
Interface methods: `endpoint()`, `execute(String,int)`, `isConfigured()`, `label()`, `model()`, `nodeId()`, `provider()`.

Nested types observed: `Node.NodeResult`, `Node.NodeException`.

### `ngl.relay.core.HttpNode` (`HttpNode.java`)
`esc(String)`, `joinMessages(List)`, `readAll(InputStream)`, `configureAuth(HttpURLConnection)`, `configureHeaders(HttpURLConnection)`, `execute(String,int)`, `extractContent(String)`, `isConfigured()`, `model()`, `nodeId()`, `provider()`, `requestBody(String)`

### `ngl.relay.core.OpenAiNode` (`OpenAiNode.java`)
`endpoint()`, `extractContent(String)`, `label()`, `requestBody(String)`

### `ngl.relay.core.GeminiNode` (`GeminiNode.java`)
`configureAuth(HttpURLConnection)`, `endpoint()`, `extractContent(String)`, `label()`, `requestBody(String)`

### `ngl.relay.core.GrokNode` (`GrokNode.java`)
`endpoint()`, `extractContent(String)`, `label()`, `requestBody(String)`

### `ngl.relay.core.ClaudeNode` (`ClaudeNode.java`)
`configureAuth(HttpURLConnection)`, `configureHeaders(HttpURLConnection)`, `endpoint()`, `extractContent(String)`, `label()`, `requestBody(String)`

## Recovery implication

The original Relay was authored as Java source, not Kotlin: the exact DEX retains `.java` source filenames for the application and core classes. Reconstruction should therefore begin in Java to minimize translation uncertainty; a Kotlin migration, if desired, belongs after behavioral equivalence is established.
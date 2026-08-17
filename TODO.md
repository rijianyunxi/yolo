# YOLO 训练台后续工作计划（TODO）

> 项目根：`D:\work\yolo`　｜　技术栈：FastAPI + React 18 + TypeScript + Vite + Ultralytics YOLO
> 更新日期：2026-08-17
> 状态：持续优化中

## 一、当前已经完成的部分（供参考）

- 多数据集/多类别配置（`cat`、`safety` 两个 profile，类别从 YAML 读取）
- 训练任务：CPU 快速试训、正式训练、停止、日志查看
- 数据检查脚本：图片/标签缺失、孤儿标签检查
- 训练图片管理、上传导入、图片删除
- 在线标注（画框、选类别、保存 YOLO 标签）
- 预测调试接口与结果展示
- 前端 React 18 重构、路由、错误边界
- 任务历史持久化（`webui/task_history.json`）
- `/files` 目录访问限制、分页、统计缓存、预测线程锁

## 二、高优先级待办

- [x] 预测接口改为“异步任务 + 轮询”：`POST /api/predict` 只接收图片并返回 `taskId`，增加 `GET /api/predictions/tasks/{id}` 获取状态与结果，避免同步推理卡住 HTTP 请求
- [x] 推理任务队列最多 1 个并发，排队中的请求明确提示“等待中/推理中/完成/失败”
- [x] 推理结果增加模型来源提示（当前训练模型 `best.pt` / 预训练 `yolo11n.pt`），前端明确显示来源，避免误用 COCO 模型
- [x] 继续把“单类别 cat”的残留写死点清理干净：后端 `DEFAULT_PROFILE`、前端默认 profile、标注默认类别，确保新增 profile 时零改动
- [x] 解决多 uvicorn 重复进程问题：启动脚本增加端口占用检测/进程清理，避免同端口起多个服务

## 三、中优先级待办

- [x] 任务历史增加“查看日志”入口：历史记录只存元数据，点击后能读取对应 `task_logs/{id}.log`
- [x] 任务日志做有限保留/清理：只保留最近 N 条，避免 `task_logs` 无限增长
- [ ] 上传标签文件在导入时校验：除扩展名 `.txt` 外，校验格式、坐标范围、类别 ID（当前部分场景已校验，可补全标注页面保存时的边界）
- [x] 扩展图片尺寸读取：`image_record` 目前 `width/height` 固定 0，在线标注画框前最好读取真实尺寸做比例换算
- [x] 标注页大数据集优化：保持分页，但前端缓存已加载的翻页结果（按 profile+split 缓存，切换时自动失效）
- [x] `/api/status` 轮询拆细：新增轻量 `GET /api/task`，前端 2.2s 只刷新任务状态/日志/历史/推理队列，全量统计（数据集、模型、环境）改为 15s 单独刷新
- [x] 预测结果列表上限可配置、支持时间范围筛选（`/api/predictions?limit=&since=&until=`，前端结果面板可设数量上限）
- [x] 增加 API 层统一错误处理与请求取消：后端未处理异常统一返回 `{detail}` JSON（500），前端轮询增加重叠请求保护，避免快速操作产生重复请求

## 四、低优先级 / 工程化

- [x] `git init` 并提交初始版本（提交 `331fc4f`），README 已加入 Conventional Commits 提交规范（正式版本发布后再打标签）
- [x] 锁定依赖版本：前端 `package-lock.json` 已有，后端已生成 `requirements.txt`（pip freeze 固定版本）
- [x] 拆分前端单文件 `main.tsx`（当前 1000+ 行）：拆成 `api.ts`、`types.ts`、`utils.ts`、`components/`
- [x] 拆分后端 `app.py`（当前约 700 行）：拆出 `config.py`、`services/`、`routes/`，便于测试和维护
- [x] 增加 `pytest` 测试：`webui/tests/test_services.py` 覆盖标注/标签校验、上传保存、任务/预测 payload、数据集统计等（14 个用例通过）
- [x] 用环境变量收敛路径配置：`YOLO_WORKDIR` 已支持，路径常量现已收敛到 `webui/config.py`
- [ ] 增加训练/数据出错的可视化提示，避免静默失败

## 五、建议的下一步

已完成：预测异步化 + 队列 + 轮询、模型来源提示、cat 写死点清理、启动脚本端口清理、历史日志查看、日志保留清理、图片尺寸读取、预测结果数量/时间范围可配置、任务失败横幅提示、`/api/status` 轮询拆细、标注页翻页缓存、API 统一错误处理；前端拆出 `api.ts`/`types.ts`/`utils.ts`/`components/`；后端拆出 `config.py`/`services/`/`routes/`；新增 `pytest` 测试与 `requirements(-dev).txt`。

接下来建议：
1. `git init` 并提交初始版本，建立提交规范和标签。
2. 端到端 UI 走查（重启服务后用浏览器验证导入→标注→训练→预测完整流程）。

## 六、验收标准（大致）

- [ ] 前端所有页面均为中文文案
- [ ] 能用 UI 完成：导入图片与标签→在线标注→数据检查→训练（试训/正式）→查看日志→预测调试
- [ ] 切换 profile（cat / safety 等）后，标注类别、训练数据、best.pt 都能自动跟随
- [ ] 新增一个 profile 时，理论上只需加一个 YAML 和目录，不动代码

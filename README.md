# YOLO 训练台

本项目位于 `D:\work\yolo`，用于本地管理 YOLO 数据集、在线标注、训练和预测调试。

## 当前环境

- Python: `3.13.2`
- 虚拟环境：`D:\work\yolo\.venv`
- Ultralytics：已安装
- PyTorch：CPU 版
- CUDA/GPU：当前未检测到 `nvidia-smi`

## 数据集配置

Web 面板右上角可以切换数据集配置。

### 猫检测

目录：

```text
D:\work\yolo\datasets\cat
```

类别：

```text
0 cat / 猫
```

### 安全生产检测

目录：

```text
D:\work\yolo\datasets\safety
```

类别：

```text
0 person / 人
1 helmet / 安全帽
2 vest / 安全衣
3 fire / 火源
```

配置文件：

```text
D:\work\yolo\datasets\safety\safety.yaml
```

## 数据目录结构

每个数据集配置下都使用相同结构：

```text
images\train
images\val
images\test
labels\train
labels\val
labels\test
```

每张图片对应一个同名 YOLO 标签文件：

```text
images\train\demo001.jpg
labels\train\demo001.txt
```

YOLO 标签格式：

```text
class_id center_x center_y width height
```

## 启动 Web 面板

```powershell
cd D:\work\yolo
.\start_webui.ps1
```

启动脚本会自动检测 `7860` 端口是否被占用：如果已有旧服务在监听，会先停止旧进程再启动新服务，避免同端口起多个 uvicorn。

打开：

```text
http://127.0.0.1:7860
```

## Web 菜单

- `总览`：环境、模型和数据集状态
- `数据集导入`：上传图片和 YOLO 标签
- `训练图片`：按 train/val/test 管理训练图片
- `在线标注`：选择类别并拖拽画框，保存为 YOLO 标签
- `训练任务`：启动 CPU 快速试训或正式训练
- `预测调试`：上传图片做预测（异步队列：提交后返回任务 ID，前端轮询“等待中 / 推理中 / 完成 / 失败”，最多 5 个排队，并标注模型来源是已训练 `best.pt` 还是预训练 `yolo11n.pt`）
- `日志与结果`：查看任务日志和运行状态

## React 前端

源码目录：

```text
D:\work\yolo\webui\frontend
```

重新构建：

```powershell
cd D:\work\yolo\webui\frontend
npm install
npm run build
```

## 测试

后端服务层测试（`pytest`，安装开发依赖后运行）：

```powershell
cd D:\work\yolo
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt -r requirements.txt
.\.venv\Scripts\python.exe -m pytest
```

前端类型检查与构建：

```powershell
cd D:\work\yolo\webui\frontend
npx tsc --noEmit
npm run build
```

## 提交规范

采用 Conventional Commits 风格，类型前缀：`feat`（新功能）、`fix`（修复）、`refactor`（重构）、`docs`（文档）、`test`（测试）、`chore`（工程化）。提交信息示例：

```text
feat: 预测改为异步队列 + 轮询
refactor: 拆分前端模块与后端 services/routes
test: 增加后端服务层 pytest 用例
```

构建产物输出到：

```text
D:\work\yolo\webui\static
```

## 命令行脚本

检查数据集：

```powershell
python scripts\check_dataset.py
```

CPU 快速试训：

```powershell
python scripts\train_cat_cpu_smoke.py
```

正式训练：

```powershell
python scripts\train_cat.py
```

预测：

```powershell
python scripts\predict_cat.py
```

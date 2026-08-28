import re

with open("webui/frontend/src/main.tsx", "r", encoding="utf-8") as f:
    content = f.read()

old = '''        <div className="sidebar-footer">
          <div className="sidebar-actions">
            <button type="button" className="btn" onClick={() => void refreshAll()}>
              <RefreshCw size={14} />
              刷新
            </button>
            {running ? (
              <button type="button" className="btn danger" onClick={() => void stopTask()}>
                <X size={14} />
                停止任务
              </button>
            ) : null}
          </div>
          <div className="status-line">
            <span className={running ? 'dot live' : 'dot'} />
            {running ? '训练任务运行中' : '当前没有运行任务'}
          </div>
          <div className="status-line">{status?.cuda ? 'GPU 可用' : 'CPU 模式'}</div>
        </div>'''

new = '''        <div className="sidebar-footer">
          <div className="sidebar-actions">
            <button type="button" className="btn" onClick={() => void refreshAll()}>
              <RefreshCw size={14} />
              刷新
            </button>
            {running ? (
              <button type="button" className="btn danger" onClick={() => void stopTask()}>
                <X size={14} />
                停止任务
              </button>
            ) : null}
          </div>
          <div className="sidebar-profile">
            <label>当前配置</label>
            <select value={datasetProfile} onChange={(e) => changeDatasetProfile(e.target.value)}>
              {profileOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.title}（{p.id}）</option>
              ))}
            </select>
          </div>
          <div className="status-line">
            <span className={running ? 'dot live' : 'dot'} />
            {running ? '训练任务运行中' : '当前没有运行任务'}
          </div>
          <div className="status-line">{status?.cuda ? 'GPU 可用' : 'CPU 模式'}</div>
        </div>'''

if old in content:
    content = content.replace(old, new)
    with open("webui/frontend/src/main.tsx", "w", encoding="utf-8") as f:
        f.write(content)
    print("Replacement succeeded")
else:
    print("Old text not found, checking...")
    idx = content.find("sidebar-footer")
    if idx >= 0:
        print(repr(content[idx:idx+600]))

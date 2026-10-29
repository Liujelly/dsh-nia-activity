# Codex 工具兼容补丁

`dsh-codex-subscription-3.1.8.patch` 对应本次使用的 `dsh-codex-subscription` 3.1.8 原始 `lib/index.js`。只提供差异补丁，不打包接入插件本体、用户账号或登录数据。

补丁将当前有效的角色/自主活动工具扁平化到 Codex 顶层请求，避免当前版本中动态追加工具未被模型正确发现的问题。仅对存在相应工具且有效工具总数不超过 128 的上下文应用；其他请求保持原逻辑。该路径关闭 additional-tools 和 tool-search 兼容选项，不修改审核模型路由。

包含 `nia_activity_group_contact` 的最终请求会将时间、模型标识和工具名称写入 `DSH_HOME/nia-activity/provider-tools.json`（未配置 DSH_HOME 时使用用户目录下的 `.dsh`）。不记录提示词、聊天正文、工具参数、模型回复或凭据。设置页只能据此确认发送前请求包含哪些名称，不能据此证明远端接收或实际执行成功。

## 应用

先退出 DSH 并备份已安装的接入插件目录。进入接入插件目录，对补丁执行检查后应用：

```sh
git apply --check /absolute/path/to/dsh-nia-activity/patches/dsh-codex-subscription-3.1.8.patch
git apply /absolute/path/to/dsh-nia-activity/patches/dsh-codex-subscription-3.1.8.patch
node --check lib/index.js
```

检查失败时不要强行应用：可能已经打过补丁，或者插件版本、构建产物已不同。安装目录如果使用包管理器硬链接，应先将文件替换为独立副本，避免同时改变共享缓存；推荐在单独复制的插件目录中应用补丁，再按 DSH 支持的本地目录方式使用。

升级接入插件可能覆盖补丁。此补丁经本机离线请求组装验证，不保证适用于其他版本或所有模型配置。它不提供桌面控制能力；Computer Use 仍由宿主工具提供。

## 上游来源

补丁针对 [WSL043/dsh-codex-subscription](https://github.com/WSL043/dsh-codex-subscription) 3.1.8，原包采用 MIT 许可；许可正文保留在 [UPSTREAM-LICENSE](UPSTREAM-LICENSE)。

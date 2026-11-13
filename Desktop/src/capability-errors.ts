export function capabilityErrorText(error: unknown, zh: boolean) {
  const message = String(error instanceof Error ? error.message : error);
  const code = /capability:([a-z-]+)/u.exec(message)?.[1];
  const messages: Record<string, [string, string]> = {
    'invalid-input': ['输入无效，请检查名称、来源和内容。', 'Invalid input. Check the name, source and content.'],
    'already-exists': ['同名资源已存在，未覆盖已有内容。', 'This resource already exists. Existing files were not replaced.'],
    'not-found': ['资源已变化或不存在，请刷新后重试。', 'The resource changed or no longer exists. Refresh and retry.'],
    'stale': ['插件内容已变化，请刷新目录后重新打开。', 'The plugin changed. Refresh the catalog and reopen it.'],
    'plugin-conflict': ['插件名称或运行时 ID 冲突，请检查市场来源和已安装副本。', 'Plugin name or runtime ID conflict. Check marketplace sources and installed copies.'],
    'invalid-configuration': ['配置或字段声明无效，未应用更改。', 'Invalid configuration or field declaration. No changes were applied.'],
    'stale-configuration': ['配置已被其他操作更新。当前草稿已保留，请重新载入后核对。', 'Configuration changed elsewhere. Your draft is retained; reload and review it.'],
    'configuration-schema-changed': ['插件配置格式已变化，旧配置未自动转换。', 'The plugin configuration schema changed. Existing settings were not converted.'],
    'configuration-consumer-conflict': ['MCP 设置覆盖了插件服务，请先检查该服务的启动配置。', 'MCP settings override this plugin service. Review its launch configuration first.'],
    'host-unavailable': ['当前运行时或插件安装不支持宿主模型设置。请更新宿主并核对安装来源。', 'This runtime or installation does not support host model settings. Update the host and check the installation source.'],
    'invalid-host-declaration': ['插件的宿主能力声明无效或版本不受支持，未授予模型访问。', 'The host capability declaration is invalid or unsupported. Model access was not granted.'],
    'host-selection-incomplete': ['独立配置已保存，但模式提交结果未确认。旧启动已失效，请重新载入后核对并保存。', 'Independent settings were saved, but the mode commit could not be confirmed. Previous launches are invalid; reload, review and save again.'],
    'invalid-path': ['路径包含链接或超出允许范围，操作已阻止。', 'The path contains links or is outside the allowed location.'],
    'read-only': ['此资源由插件或运行时管理，不能单独修改。', 'This resource is managed by its plugin or runtime.'],
    'too-large': ['来源文件过多或过大，未完成导入。', 'The source contains too many files or is too large.'],
    'marketplace-failed': ['市场操作失败，请检查来源、网络和 Git 环境。', 'Marketplace operation failed. Check the source, network and Git environment.'],
    'marketplace-network': ['市场连接中断或无法建立连接，请检查网络后重试。', 'The marketplace connection failed or was interrupted. Check the network and retry.'],
    'marketplace-dns': ['无法解析市场服务器地址，请检查网络或 DNS。', 'The marketplace server address could not be resolved. Check the network or DNS.'],
    'marketplace-proxy': ['连接市场的代理不可用或需要认证，请检查代理设置。', 'The marketplace proxy is unavailable or requires authentication. Check its settings.'],
    'marketplace-tls': ['市场连接的证书校验失败，请检查系统时间、证书或代理。', 'Marketplace certificate verification failed. Check the system clock, certificates or proxy.'],
    'marketplace-auth': ['Git 无法完成市场认证或访问被拒绝，请检查访问权限。', 'Git could not authenticate to the marketplace or access was denied. Check access permissions.'],
    'marketplace-source-unavailable': ['市场仓库不可访问，请检查来源地址及访问权限。', 'The marketplace repository is unavailable. Check its address and access permissions.'],
    'marketplace-git-missing': ['插件管理进程找不到 Git，请检查 Git 安装及启动环境。', 'The plugin management process could not find Git. Check its installation and launch environment.'],
    'marketplace-permission': ['无法写入市场缓存，访问被系统拒绝。请检查目录权限。', 'The system denied access to the marketplace cache. Check directory permissions.'],
    'marketplace-locked': ['市场缓存存在 Git 锁或文件占用，请等待相关操作结束后重试，勿直接删除锁文件。', 'The marketplace cache is locked or in use. Wait for the owning operation; do not delete lock files blindly.'],
    'marketplace-conflict': ['市场缓存无法快进更新，存在本地更改或分支分歧。请保留现场以便排查。', 'The marketplace cache cannot fast-forward because of local changes or divergent history. Preserve it for diagnosis.'],
    'marketplace-timeout': ['市场刷新超时，未能确认完成。请检查连接后手动重试。', 'Marketplace refresh timed out and completion was not confirmed. Check the connection before retrying manually.'],
    'marketplace-cancelled': ['市场刷新已取消，未能确认完成。', 'Marketplace refresh was cancelled and completion was not confirmed.'],
    'marketplace-output-limit': ['Git 输出超出安全上限，市场刷新未完成。请保留诊断编号。', 'Git exceeded the safe output limit. Marketplace refresh did not complete; retain the diagnostic ID.'],
    'profile-isolation': ['无法确认 Desktop 独立配置，操作已阻止。', 'Desktop profile isolation could not be verified.'],
    'resource-in-use': ['插件仍被会话占用或无法确认已释放。请先在 MCP 中停用其服务并重启相关会话，再更新或卸载。', 'The plugin is still in use or its release could not be verified. Disable its MCP servers and restart the relevant sessions before updating or uninstalling.'],
    'update-capabilities-changed': ['新版的服务结构或默认开关已变化，需要迁移确认；本次未替换旧版。', 'Service declarations or defaults changed and require migration review; the installed version was not replaced.'],
    'update-recovery-required': ['插件更新恢复未完成。请停止使用该插件并保留现场，不要重装覆盖；需要检查恢复记录。', 'Plugin update recovery needs attention. Stop using this plugin and preserve its files; do not overwrite it by reinstalling.'],
    'release-unconfirmed': ['无法确认相关进程已全部退出，未继续更新。请查看会话状态后重新检查。', 'Complete process exit could not be confirmed. The update was stopped; review the sessions and check again.'],
    'runtime-history-unavailable': ['会话的持久历史暂不可用，无法安全重启。请保留会话并核对历史文件后再更新。', 'Saved session history is unavailable, so this session cannot be safely restarted. Preserve it and review the history files before updating.'],
    'update-operation-interrupted': ['上次更新被中断，安装与会话恢复结果需要核对。请保留现场，不要重复更新。', 'The previous update was interrupted. Verify installation and session recovery before retrying; preserve the existing files.'],
    'update-operation-record-failed': ['更新进度记录未能保存，请核对安装结果和会话状态，勿重复提交。', 'Update progress could not be saved. Review the installation and sessions; do not repeat the update blindly.'],
    'busy': ['共享设置、撤销或更新操作尚未结束，请完成后重试。', 'A shared settings, undo or update operation is still in progress. Finish it and retry.'],
    'workspace-busy': ['工作区正在切换，请等待切换完成后重试。', 'The workspace is changing. Wait for it to finish and retry.'],
    'session-busy': ['有会话仍在执行任务、整理上下文或变更状态，请结束后重试。', 'A session is running, compacting or changing state. Wait for it to finish and retry.'],
    'remote-attached': ['有会话仍绑定 Remote，请先解除绑定后重试。', 'A session is still attached to Remote. Unbind it and retry.'],
    'side-question-active': ['有会话的旁路提问尚未结束，请完成或取消后重试。', 'A session has an active side question. Finish or cancel it and retry.'],
    'background-active': ['有会话仍有后台代理在运行，请结束后台任务后重试。', 'A session still has active background agents. Finish their work and retry.'],
    'goal-active': ['有会话的 Goal 仍在运行，请先暂停该目标后重试。', 'A session has an active Goal. Pause it and retry.'],
    'messages-queued': ['有会话还有待发送消息，请发送或撤回后重试。', 'A session has pending messages. Send or withdraw them and retry.'],
    'runtime-unavailable': ['无法确认会话运行状态：运行时未连接或查询超时。请检查连接后重试。', 'The runtime is disconnected or its state query timed out. Check the connection and retry.'],
    'access-denied': ['无法修改插件文件或记录：访问被拒绝。请检查目录权限。', 'Access to plugin files or records was denied. Check directory permissions.'],
    'operation-denied': ['系统拒绝修改插件文件或记录，可能与权限或文件占用有关。', 'The system refused to modify plugin files or records. Check permissions and open file handles.'],
    'file-in-use': ['插件文件或目录正在被使用，请释放占用后重试。', 'A plugin file or directory is in use. Release it and retry.'],
    'directory-not-empty': ['目录删除未完成，仍有残留文件。请保留现场以便排查。', 'Directory removal did not finish and files remain. Preserve them for diagnosis.'],
    'storage': ['插件管理记录无法读取或格式无效，请保留现场以便排查。', 'Plugin management records are unreadable or invalid. Preserve them for diagnosis.'],
    'management-unavailable': ['无法确认管理进程已退出，已暂停后续插件操作。请保留现场，重启应用后核对安装状态。', 'The management process may still be running. Further plugin operations are blocked. Preserve the files and restart the app to reconcile its state.'],
    'management-committed': ['更改已提交，但无法确认管理进程已退出。请勿重复操作；重启应用后核对结果。', 'The change was committed, but management process exit could not be confirmed. Do not retry; restart the app and verify the result.'],
    'management-uncertain': ['管理进程异常，无法确认操作是否已提交。已暂停后续操作，请勿重复安装或卸载。', 'The management operation outcome is unknown. Further operations are blocked; do not repeat the installation or removal.'],
    'scheduled-work': ['仍有定时任务可能使用插件资源，请先停用相关 Cron 任务后再修改。', 'Scheduled work may use these plugin resources. Disable its Cron jobs before making changes.'],
  };
  const text = messages[code ?? '']?.[zh ? 0 : 1]
    ?? (zh ? '操作未完成，请检查资源及运行状态后重试。' : 'The operation did not complete. Check the resource and session state, then retry.');
  const diagnosticId = /\bdiagnostic:([a-f0-9]{12})\b/u.exec(message)?.[1];
  return diagnosticId ? `${text} ${zh ? '诊断编号：' : 'Diagnostic ID: '}${diagnosticId}` : text;
}

export function capabilityWarningText(value: string, zh: boolean) {
  return /^capability:[a-z-]+(?:; diagnostic:[a-f0-9]{12})?$/u.test(value)
    ? capabilityErrorText(value, zh) : value;
}

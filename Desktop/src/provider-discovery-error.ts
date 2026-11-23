export function providerDiscoveryError(error: unknown, language: string): string {
  const t = (zh: string, en: string) => language === 'en' ? en : zh;
  const message = error instanceof Error ? error.message : '';
  // IPC adds a wrapper to errors. Only recognize our own bounded labels, never echo upstream text.
  const status = message.match(/\bModel discovery HTTP (\d{3})\b/)?.[1];
  if (status) {
    const detail = status === '401' || status === '403'
      ? t('认证或访问被拒绝，请检查密钥、权限及网络出口。', 'Authentication or access denied; check the key, permissions and network exit.')
      : status === '404'
        ? t('模型列表接口不存在，请检查 Base URL，或手动添加模型。', 'Model list endpoint not found; check the Base URL or add models manually.')
        : status === '429'
          ? t('请求受限，请稍后重试。', 'Rate limited; try again later.')
          : t('上游拒绝了模型列表请求，请稍后重试。', 'The provider rejected the model list request; try again later.');
    return `HTTP ${status} · ${detail}`;
  }
  if (message.includes('An official API key is required')) return t('请填写官方 API Key，不能使用账号登录凭证。', 'Enter an official API key, not an account login credential.');
  if (message.includes('Model discovery timed out')) return t('获取模型超时（15 秒），请检查网络和系统代理。', 'Model discovery timed out (15 seconds); check the network and system proxy.');
  return t('无法获取模型，请检查地址、密钥、网络和系统代理；也可手动添加模型。', 'Could not retrieve models; check the address, key, network and system proxy, or add models manually.');
}

const ERROR_MAP: Record<string, string> = {
  'Failed to fetch': '无法连接服务器，请检查网络',
  'invalid password': '密码错误',
  'invalid credentials': '用户名或密码错误',
  'unauthorized': '认证已过期，请重新登录',
  'invalid request': '请求格式错误',
  'name required': '名称不能为空',
  'session id required': '缺少会话 ID',
  'username, email, and password required': '请填写用户名、邮箱和密码',
  'password must be at least 6 characters': '密码至少 6 个字符',
  'username or email already exists': '用户名或邮箱已被注册',
  'failed to generate token': '服务器内部错误，请稍后重试',
  'user not found': '用户不存在',
  'server not found': '服务器未找到，可能未绑定到当前账号',
  'server offline': '服务器离线，请确认 daemon 已启动',
  'agent_id required': '缺少 Agent ID',
  'pane_id required': '缺少 Pane ID',
  'snapshot_timeout': '终端快照加载超时，请刷新重试',
  'snapshot_failed': '终端快照加载失败，请刷新重试',
}

/** 将 API 错误消息翻译为用户友好的中文 */
export function translateError(msg: string): string {
  if (!msg) return msg

  // 精确匹配
  const exact = ERROR_MAP[msg]
  if (exact) return exact

  // 忽略大小写匹配
  const lower = msg.toLowerCase()
  for (const [key, value] of Object.entries(ERROR_MAP)) {
    if (lower === key.toLowerCase()) return value
  }

  // 通用模式匹配
  if (lower.includes('timeout') || lower.includes('aborterror')) {
    return '连接超时，请检查网络'
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return '网络连接失败'
  }
  if (msg.startsWith('HTTP ')) {
    return `服务器错误 (${msg})`
  }

  // 兜底：原样返回
  return msg
}

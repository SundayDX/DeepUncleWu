import Taro from '@tarojs/taro'

// 接口响应类型定义
export interface ApiResponse<T> {
  code: number
  data: T
  message: string
}

// 消息类型定义
export interface Message {
  id: string
  content: string
  type: 'user' | 'ai' | 'system'
  timestamp: number
  voiceUrl?: string
  duration?: number
  streamingContent?: string
}

// SSE 事件类型定义
interface SSEEvent {
  type?: string
  content?: string
  status?: string
  progress?: number
  usage?: {
    prompt_tokens: number
    prompt_unit_price: string
    prompt_price_unit: string
    prompt_price: string
    completion_tokens: number
    completion_unit_price: string
    completion_price_unit: string
    completion_price: string
    total_tokens: number
    total_price: string
    currency: string
    latency: number
  }
}

// API 配置
const API_CONFIG = {
  // 这里配置您的 API 地址
  baseUrl: 'https://unclewu.walkyren.com/api/v1',
  timeout: 30000,
  headers: {
    'Authorization': `Bearer uk_b34a1aa50709aa632243fd7edd123fc412ece5c9044c6af8`,
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream'
  }
}

// 发送文本消息到 AI
export async function sendTextMessage(
  content: string,
  onChunk?: (text: string) => void,
  onProgress?: (progress: number) => void
): Promise<Message> {
  try {
    return new Promise((resolve, reject) => {
      let fullContent = ''
      let messageId = Date.now().toString()
      let isCompleted = false

      const requestTask = Taro.request({
        url: `${API_CONFIG.baseUrl}/chat`,
        method: 'POST',
        data: { 
          context: content
        },
        header: {
          ...API_CONFIG.headers,
          'Accept': 'text/event-stream'
        },
        timeout: API_CONFIG.timeout,
        enableChunked: true,
        dataType: '其他',
        success: (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(response.data?.message || '请求失败'))
          }
        },
        fail: (error) => {
          console.error('请求失败：', error)
          reject(error)
        },
        complete: () => {
          if (!isCompleted) {
            const message: Message = {
              id: messageId,
              content: fullContent || '抱歉，响应出现了问题',
              type: 'ai',
              timestamp: Date.now()
            }
            resolve(message)
          }
        }
      })

      requestTask.onChunkReceived((response) => {
        try {
          let chunk: string
          if (response.data instanceof ArrayBuffer) {
            chunk = String.fromCharCode.apply(null, new Uint8Array(response.data))
          } else if (typeof response.data === 'string') {
            chunk = response.data
          } else {
            chunk = JSON.stringify(response.data)
          }
          
          const lines = chunk.split('\n\n')
          const filteredLines = lines.filter(line => line.trim().startsWith('data: '))
          
          for (const line of filteredLines) {
            try {
              const jsonStr = line.replace('data: ', '').trim()
              const event = JSON.parse(jsonStr)

              if (event.type === 'text_chunk') {
                fullContent += event.content
                onChunk?.(event.content)
              } else if (event.status) {
                onProgress?.(event.progress || 0)

                if (event.status === 'COMPLETED') {
                  isCompleted = true
                  const message: Message = {
                    id: messageId,
                    content: fullContent,
                    type: 'ai',
                    timestamp: Date.now()
                  }
                  resolve(message)
                }
              }
            } catch (e) {
              console.error('解析单行数据失败：', {
                line,
                error: e
              })
            }
          }
        } catch (error) {
          console.error('处理数据块失败：', {
            error,
            fullContent,
            isCompleted
          })
          if (!isCompleted) {
            // 不要在这里 reject，让请求继续进行
            console.error('处理数据块出错，但继续等待其他数据块')
          }
        }
      })

      requestTask.onHeadersReceived?.((res) => {
        // 保持空白，移除日志
      })
    })
  } catch (error) {
    console.error('整个请求过程失败：', error)
    throw error
  }
}

// 发送语音消息到 AI
export async function sendVoiceMessage(voiceUrl: string, duration: number): Promise<Message> {
  try {
    // 这里替换为实际的 API 调用
    const response = await Taro.request({
      url: `${API_CONFIG.baseUrl}/chat/voice`,
      method: 'POST',
      data: { 
        voiceUrl,
        duration 
      },
      header: API_CONFIG.headers,
      timeout: API_CONFIG.timeout
    })

    if (response.statusCode === 200) {
      return response.data as Message
    }

    throw new Error(response.data?.message || '请求失败')
  } catch (error) {
    console.error('发送语音消息失败：', error)
    throw error
  }
}

// 创建 HTTP 请求客户端
export const createHttpClient = () => {
  const client = {
    get: async <T>(url: string, params?: any): Promise<T> => {
      const response = await Taro.request({
        url: `${API_CONFIG.baseUrl}${url}`,
        method: 'GET',
        data: params,
        header: API_CONFIG.headers,
        timeout: API_CONFIG.timeout
      })
      return handleResponse<T>(response)
    },

    post: async <T>(url: string, data?: any): Promise<T> => {
      const response = await Taro.request({
        url: `${API_CONFIG.baseUrl}${url}`,
        method: 'POST',
        data,
        header: API_CONFIG.headers,
        timeout: API_CONFIG.timeout
      })
      return handleResponse<T>(response)
    }
  }

  return client
}
// 处理响应
function handleResponse<T>(response: any): T {
  if (response.statusCode === 200) {
    return response.data as T
  }
  throw new Error(response.data?.message || '请求失败')
}

// 导出 HTTP 客户端实例
export const httpClient = createHttpClient()

// 请求麦克风权限
export async function requestMicrophonePermission(): Promise<boolean> {
  try {
    const { authSetting } = await Taro.getSetting()
    
    // 如果已经授权，直接返回 true
    if (authSetting['scope.record']) {
      return true
    }

    // 如果未授权，发起授权请求
    const { errMsg } = await Taro.authorize({
      scope: 'scope.record'
    })
    
    return errMsg === 'authorize:ok'
  } catch (error) {
    console.error('请求麦克风权限失败：', error)
    
    // 如果用户拒绝授权，引导用户去设置页面开启权限
    if (error.errMsg?.includes('authorize:fail')) {
      const { confirm } = await Taro.showModal({
        title: '需要麦克风权限',
        content: '请在设置中开启麦克风权限，以便使用语音功能',
        confirmText: '去设置'
      })
      
      if (confirm) {
        await Taro.openSetting()
        // 重新检查权限
        const { authSetting } = await Taro.getSetting()
        return !!authSetting['scope.record']
      }
    }
    
    return false
  }
} 
import React, { useState, useRef, useEffect } from 'react'
import { View, ScrollView, Textarea, Text } from '@tarojs/components'
import { Button } from '@nutui/nutui-react-taro'
import Taro from '@tarojs/taro'
import { useLoad } from '@tarojs/taro'
import { sendTextMessage, sendVoiceMessage } from '../../services/api'
import './index.scss'

interface Message {
  id: string
  content: string
  type: 'user' | 'ai' | 'system'
  timestamp: number
  voiceUrl?: string // 语音消息的临时文件路径
  duration?: number // 语音消息时长（秒）
  streamingContent?: string // 用于流式渲染的内容
  progress?: number // 添加进度属性
}

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${hours}:${minutes}`
}

const MESSAGES_STORAGE_KEY = 'chat_messages'
const VOICE_FILE_PREFIX = 'voice_'

const ChatPage: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      content: '智能强叔为您服务',
      type: 'system',
      timestamp: Date.now()
    },
    {
      id: '1',
      content: '你好！我是智能强叔，很高兴为您服务。',
      type: 'ai',
      timestamp: Date.now()
    }
  ])
  const [inputText, setInputText] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [isVoiceMode, setIsVoiceMode] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [recordingTime, setRecordingTime] = useState(0)
  const [hasRecordPermission, setHasRecordPermission] = useState(false)
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null)
  const messageListRef = useRef<Message[]>(messages)
  const recorderManager = useRef<Taro.RecorderManager>()
  const recordingTimer = useRef<NodeJS.Timeout>()
  const recordingTimeRef = useRef(0)
  const touchStartTimeRef = useRef(0)
  const isStartingRef = useRef(false)
  const startTimeoutRef = useRef<NodeJS.Timeout>()
  const isCanceledRef = useRef(false)
  const shouldStartRef = useRef(false)
  const MIN_RECORD_TIME = 1 // 最短录音时长（秒）
  const MAX_RECORD_TIME = 120 // 最长录音时长（秒）
  const MIN_PRESS_TIME = 300 // 最短按压时间（毫秒）
  const START_TIMEOUT = 1000 // 录音启动超时时间（毫秒）
  const innerAudioContext = useRef<Taro.InnerAudioContext>()

  // 重置录音状态
  const resetRecordingState = (preserveCancel = false) => {
    setIsRecording(false)
    isStartingRef.current = false
    shouldStartRef.current = false
    if (!preserveCancel) {
      isCanceledRef.current = false
    }
    if (recordingTimer.current) {
      clearInterval(recordingTimer.current)
      recordingTimer.current = undefined
    }
    if (startTimeoutRef.current) {
      clearTimeout(startTimeoutRef.current)
      startTimeoutRef.current = undefined
    }
    setRecordingTime(0)
    recordingTimeRef.current = 0
    touchStartTimeRef.current = 0
  }

  // 停止录音
  const stopRecording = (skipErrorToast = false) => {
    try {
      // 只有在真正开始录音的情况下才调用 stop
      if (recorderManager.current && isRecording) {
        recorderManager.current.stop()
      }
    } catch (error) {
      console.error('停止录音失败，详细错误：', {
        message: error?.message,
        stack: error?.stack,
        error,
        state: {
          isRecording,
          isStarting: isStartingRef.current,
          shouldStart: shouldStartRef.current,
          isCanceled: isCanceledRef.current,
          touchStartTime: touchStartTimeRef.current,
          recordingTime: recordingTimeRef.current
        }
      })
      if (!skipErrorToast) {
        Taro.showToast({
          title: `录音失败：${error?.message || '未知错误'}`,
          icon: 'error',
          duration: 2000
        })
      }
    }
    resetRecordingState(skipErrorToast)
  }

  // 检查录音权限
  const checkRecordPermission = async () => {
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
      
      if (errMsg === 'authorize:ok') {
        return true
      }

      // 如果授权失败，提示用户去设置页面开启权限
      const { confirm } = await Taro.showModal({
        title: '需要录音权限',
        content: '请在设置中开启录音权限，以便使用语音功能',
        confirmText: '去设置',
        cancelText: '取消'
      })
      
      if (confirm) {
        await Taro.openSetting()
        // 重新检查权限
        const { authSetting: newAuthSetting } = await Taro.getSetting()
        return !!newAuthSetting['scope.record']
      }

      return false
    } catch (error) {
      console.error('检查录音权限失败：', {
        error,
        message: error?.message,
        errMsg: error?.errMsg
      })
      
      // 如果是用户拒绝授权，给出友好提示
      if (error.errMsg?.includes('authorize:fail')) {
        Taro.showToast({
          title: '需要录音权限才能发送语音',
          icon: 'none',
          duration: 2000
        })
      }
      
      return false
    }
  }

  // 初始化音频播放器
  useEffect(() => {
    innerAudioContext.current = Taro.createInnerAudioContext()
    
    // 设置音频播放器属性
    innerAudioContext.current.obeyMuteSwitch = false // 是否遵循系统静音开关，默认为 true。当此参数为 false 时，即使用户打开了静音开关，也能继续发出声音。
    innerAudioContext.current.volume = 1.0 // 音量，范围 0~1
    
    innerAudioContext.current.onPlay(() => {
    })
    
    innerAudioContext.current.onEnded(() => {
      setPlayingMessageId(null)
    })
    
    innerAudioContext.current.onError((res) => {
      console.error('音频播放错误：', res.errMsg)
      setPlayingMessageId(null)
      Taro.showToast({
        title: '播放失败',
        icon: 'error',
        duration: 800
      })
    })

    innerAudioContext.current.onCanplay(() => {
    })

    innerAudioContext.current.onWaiting(() => {
    })

    innerAudioContext.current.onSeeking(() => {
    })

    innerAudioContext.current.onSeeked(() => {
    })

    return () => {
      innerAudioContext.current?.destroy()
    }
  }, [])

  // 初始化录音管理器
  const initRecorderManager = () => {
    if (!recorderManager.current) {
      recorderManager.current = Taro.getRecorderManager()
      
      recorderManager.current.onStart(() => {
        console.log('录音开始')
        isStartingRef.current = false
        setIsRecording(true)
        // 清除启动超时定时器
        if (startTimeoutRef.current) {
          clearTimeout(startTimeoutRef.current)
          startTimeoutRef.current = null
        }
      })

      recorderManager.current.onStop(async (res) => {
        console.log('录音结束：', res)
        const { tempFilePath, duration } = res
        if (!tempFilePath) {
          console.error('录音结果中没有临时文件路径')
          return
        }
        // 处理录音结果...
      })

      recorderManager.current.onError((res) => {
        console.error('录音错误：', res)
        Taro.showToast({
          title: `录音失败：${res?.errMsg || '录音错误'}`,
          icon: 'none',
          duration: 2000
        })
        resetRecordingState(true)
      })
    }
  }

  // 在组件挂载时初始化录音管理器
  useEffect(() => {
    initRecorderManager()
  }, [])

  // 自动滚动到底部
  useEffect(() => {
    messageListRef.current = messages
    // 使用 nextTick 确保在 DOM 更新后滚动
    Taro.nextTick(() => {
      setScrollTop(prev => prev + 9999)
    })
  }, [messages])

  useLoad(() => {
    // 禁用页面整体的弹性滚动
    document.body.style.overflow = 'hidden'
    // Taro.setPageStyle 在当前版本不存在，使用替代方案
    // 如果需要禁用页面滚动，可以在页面配置中设置
  })

  // 切换输入模式
  const toggleInputMode = () => {
    setIsVoiceMode(prev => !prev)
    setIsRecording(false)
  }

  // 开始录音
  const handleTouchStart = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (isRecording || isStartingRef.current) {
      return
    }

    // 记录触摸开始时间
    touchStartTimeRef.current = Date.now()
    // 设置录音正在启动的标记
    isStartingRef.current = true
    isCanceledRef.current = false
    shouldStartRef.current = true

    // 设置启动超时
    startTimeoutRef.current = setTimeout(() => {
      if (isStartingRef.current) {
        resetRecordingState(true)
        const timeoutError = {
          message: '启动超时',
          startTime: touchStartTimeRef.current,
          currentTime: Date.now(),
          duration: Date.now() - touchStartTimeRef.current
        }
        console.error('录音启动失败，详细信息：', timeoutError)
        Taro.showToast({
          title: '录音启动失败：超时',
          icon: 'error',
          duration: 2000
        })
      }
    }, START_TIMEOUT)

    try {
      // 检查录音权限
      const hasPermission = await checkRecordPermission()
      if (!hasPermission) {
        console.error('录音失败，详细信息：', {
          error: '没有录音权限',
          authSetting: (await Taro.getSetting()).authSetting
        })
        resetRecordingState(true)
        return
      }

      // 检查是否应该开始录音
      if (!shouldStartRef.current) {
        resetRecordingState(true)
        return
      }

      // 开始录音
      recorderManager.current?.start({
        duration: MAX_RECORD_TIME * 1000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 96000,
        format: 'mp3',
        frameSize: 50
      })
    } catch (error) {
      console.error('开始录音失败，详细错误：', {
        message: error?.message,
        stack: error?.stack,
        error,
        state: {
          isRecording,
          isStarting: isStartingRef.current,
          shouldStart: shouldStartRef.current,
          isCanceled: isCanceledRef.current,
          touchStartTime: touchStartTimeRef.current,
          recordingTime: recordingTimeRef.current
        }
      })
      resetRecordingState(true)
      if (!isCanceledRef.current) {
        Taro.showToast({
          title: `录音失败：${error?.message || '启动失败'}`,
          icon: 'error',
          duration: 2000
        })
      }
    }
  }

  // 结束录音
  const handleTouchEnd = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    const pressDuration = Date.now() - touchStartTimeRef.current

    // 如果按压时间太短，直接取消录音
    if (pressDuration < MIN_PRESS_TIME) {
      shouldStartRef.current = false
      isCanceledRef.current = true
      
      // 只有在真正开始录音或正在启动时才需要停止
      if (isStartingRef.current || isRecording) {
        stopRecording(true)
      } else {
        resetRecordingState(true)
      }
      
      Taro.showToast({
        title: '按住时间太短',
        icon: 'none',
        duration: 800
      })
      return
    }

    if (!isRecording && !isStartingRef.current) {
      return
    }

    shouldStartRef.current = false
    stopRecording(false)
  }

  // 取消录音
  const handleTouchCancel = (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!isRecording && !isStartingRef.current) {
      return
    }

    shouldStartRef.current = false
    isCanceledRef.current = true
    stopRecording(true)
    Taro.showToast({
      title: '已取消',
      icon: 'none',
      duration: 800
    })
  }

  // 处理输入事件
  const handleInput = (e) => {
    const value = e.detail.value
    setInputText(value)
  }

  // 处理键盘高度变化
  const handleKeyboardHeightChange = (event) => {
    const height = event.detail.height
    setKeyboardHeight(height)
    // 键盘高度变化时，滚动消息列表到底部
    Taro.nextTick(() => {
      setScrollTop(prev => prev + 9999)
    })
  }

  // 处理发送事件
  const handleSend = async (e) => {
    const content = e.detail.value.trim()
    if (!content) return

    try {
      
      // 添加用户消息
      const userMessage: Message = {
        id: Date.now().toString(),
        content,
        type: 'user',
        timestamp: Date.now()
      }
      
      setMessages(prev => [...prev, userMessage])
      setInputText('')

      // 创建一个临时的 AI 消息用于流式渲染
      const tempAiMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: '',
        type: 'ai',
        timestamp: Date.now(),
        streamingContent: '',
        progress: 0
      }
      
      setMessages(prev => [...prev, tempAiMessage])

      // 发送消息到 AI，并处理流式响应
      const aiResponse = await sendTextMessage(
        content,
        (chunk) => {
          // 更新临时消息的流式内容
          setMessages(prev => {
            const lastMessage = prev[prev.length - 1]
            if (lastMessage.id === tempAiMessage.id) {
              return [
                ...prev.slice(0, -1),
                {
                  ...lastMessage,
                  content: lastMessage.content + chunk,
                  streamingContent: lastMessage.content + chunk
                }
              ]
            }
            return prev
          })
        },
        (progress) => {
          // 更新进度
          setMessages(prev => {
            const lastMessage = prev[prev.length - 1]
            if (lastMessage.id === tempAiMessage.id) {
              return [
                ...prev.slice(0, -1),
                {
                  ...lastMessage,
                  progress
                }
              ]
            }
            return prev
          })
        }
      )
      
      // 更新最终的 AI 消息
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1]
        if (lastMessage.id === tempAiMessage.id) {
          return [
            ...prev.slice(0, -1),
            {
              ...aiResponse,
              content: lastMessage.content, // 使用累积的内容
              progress: 100 // 设置最终进度为 100
            }
          ]
        }
        return prev
      })
    } catch (error) {
      console.error('发送消息失败：', error)
      Taro.showToast({
        title: '发送失败，请重试',
        icon: 'error',
        duration: 2000
      })
    }
  }

  // 渲染消息内容
  const renderMessageContent = (message: Message) => {
    if (message.voiceUrl) {
      return (
        <View className='voice-message' onClick={() => handlePlayVoice(message)}>
          <View className='voice-content'>
            {message.type === 'user' ? (
              <>
                <Text className='duration'>{message.duration}"</Text>
                <View className={`voice-wave ${playingMessageId === message.id ? 'playing' : ''}`}>
                  <View className='wave-line'></View>
                  <View className='wave-line'></View>
                  <View className='wave-line'></View>
                </View>
              </>
            ) : (
              <>
                <View className={`voice-wave ${playingMessageId === message.id ? 'playing' : ''}`}>
                  <View className='wave-line'></View>
                  <View className='wave-line'></View>
                  <View className='wave-line'></View>
                </View>
                <Text className='duration'>{message.duration}"</Text>
              </>
            )}
          </View>
        </View>
      )
    }

    // 文本消息
    return (
      <View className='text-message'>
        <View className='message-content'>
          {message.content}
          {message.streamingContent !== undefined && message.content === '' && (
            <Text className='cursor'>|</Text>
          )}
        </View>
        {message.type === 'ai' && message.progress !== undefined && message.progress < 100 && (
          <View className='progress-bar'>
            <View 
              className='progress-inner' 
              style={{ width: `${message.progress}%` }}
            />
          </View>
        )}
      </View>
    )
  }

  // 加载历史消息
  const loadMessages = async () => {
    try {
      const storedMessages = await Taro.getStorage({ key: MESSAGES_STORAGE_KEY })
      if (storedMessages?.data) {
        setMessages(storedMessages.data)
      }
    } catch (error) {
      console.error('加载历史消息失败：', error)
    }
  }

  // 保存消息到本地存储
  const saveMessages = async (newMessages: Message[]) => {
    try {
      await Taro.setStorage({
        key: MESSAGES_STORAGE_KEY,
        data: newMessages
      })
    } catch (error) {
      console.error('保存消息失败：', error)
    }
  }

  // 保存语音文件
  const saveVoiceFile = async (tempFilePath: string): Promise<string> => {
    try {
      // 获取本地文件管理器
      const fs = Taro.getFileSystemManager()
      const fileName = `${VOICE_FILE_PREFIX}${Date.now()}.mp3`
      const savedPath = `${Taro.env.USER_DATA_PATH}/${fileName}`

      // 将临时文件保存到本地
      await new Promise((resolve, reject) => {
        fs.saveFile({
          tempFilePath,
          filePath: savedPath,
          success: (res) => {
            resolve(res)
          },
          fail: (error) => {
            console.error('语音文件保存失败：', error)
            reject(error)
          }
        })
      })

      return savedPath
    } catch (error) {
      console.error('保存语音文件失败，详细错误：', {
        error,
        tempFilePath,
        userPath: Taro.env.USER_DATA_PATH
      })
      throw error
    }
  }

  // 初始化时加载历史消息
  useEffect(() => {
    loadMessages()
  }, [])

  // 当消息更新时保存到本地存储
  useEffect(() => {
    if (messages.length > 0) {
      saveMessages(messages)
    }
  }, [messages])

  // 播放语音消息
  const handlePlayVoice = async (message: Message) => {
    if (!message.voiceUrl) {
      console.error('语音文件路径不存在')
      return
    }

    try {
      console.log('准备播放语音，详细信息：', {
        messageId: message.id,
        voiceUrl: message.voiceUrl,
        duration: message.duration,
        currentlyPlaying: playingMessageId,
        audioContext: innerAudioContext.current ? '已初始化' : '未初始化'
      })

      // 如果正在播放同一条消息，则停止播放
      if (playingMessageId === message.id) {
        innerAudioContext.current?.stop()
        setPlayingMessageId(null)
        return
      }

      // 如果正在播放其他消息，先停止
      if (playingMessageId) {
        innerAudioContext.current?.stop()
      }

      // 检查文件是否存在
      const fs = Taro.getFileSystemManager()
      await new Promise<void>((resolve, reject) => {
        fs.access({
          path: message.voiceUrl!,
          success: () => {
            // 读取文件内容以验证
            fs.readFile({
              filePath: message.voiceUrl!,
              success: (res) => {
                resolve()
              },
              fail: (error) => {
                console.error('读取语音文件失败：', error)
                reject(new Error('无法读取语音文件'))
              }
            })
          },
          fail: (error) => {
            console.error('语音文件访问失败：', error)
            reject(new Error('语音文件不存在'))
          }
        })
      })

      // 销毁旧的音频上下文
      if (innerAudioContext.current) {
        innerAudioContext.current.destroy()
      }

      // 创建新的音频上下文
      innerAudioContext.current = Taro.createInnerAudioContext()
      
      // 设置音频属性
      innerAudioContext.current.obeyMuteSwitch = false
      innerAudioContext.current.volume = 1.0
      innerAudioContext.current.playbackRate = 1.0
      
      // 绑定事件监听
      innerAudioContext.current.onPlay(() => {
      })
      
      innerAudioContext.current.onEnded(() => {
        setPlayingMessageId(null)
      })
      
      innerAudioContext.current.onError((res) => {
        console.error('音频播放错误：', res)
        setPlayingMessageId(null)
        Taro.showToast({
          title: '播放失败',
          icon: 'error',
          duration: 800
        })
      })

      innerAudioContext.current.onCanplay(() => {
      })

      innerAudioContext.current.onTimeUpdate(() => {
      })

      // 设置音频源并播放
      innerAudioContext.current.src = message.voiceUrl

      // 开始播放
      innerAudioContext.current.play()
      setPlayingMessageId(message.id)
    } catch (error) {
      console.error('播放语音失败，详细错误：', {
        error,
        voiceUrl: message.voiceUrl,
        message
      })
      Taro.showToast({
        title: '播放失败',
        icon: 'error',
        duration: 2000
      })
      setPlayingMessageId(null)
    }
  }

  return (
    <View className='chat-page'>
      <View className='chat-container'>
        <ScrollView
          className='message-list'
          scrollY
          scrollTop={scrollTop}
          scrollWithAnimation
          enhanced
          bounces={false}
          showScrollbar={false}
          scrollIntoView={`msg-${messages[messages.length - 1]?.id}`}
        >
          {messages.map(message => (
            <View
              key={message.id}
              id={`msg-${message.id}`}
              className={`message-item ${message.type === 'user' ? 'user' : message.type === 'ai' ? 'ai' : 'system'}`}
            >
              {message.type !== 'system' ? (
                <>
                  <View className='avatar'>
                    {message.type === 'user' ? '👤' : '🤖'}
                  </View>
                  <View className='message-wrapper'>
                    {renderMessageContent(message)}
                    <View className='message-time'>{formatTime(message.timestamp)}</View>
                  </View>
                </>
              ) : (
                <View className='message-wrapper'>
                  <View className='message-content system-content'>{message.content}</View>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      </View>

      <View 
        className={`input-area ${keyboardHeight === 0 ? 'with-safe-area' : ''}`}
        style={{ 
          bottom: keyboardHeight > 0 ? `${keyboardHeight}px` : '0'
        }}
      >
        <View className='input-box'>
          {isVoiceMode ? (
            <>
              <Button className='mode-switch-button' onClick={toggleInputMode}>⌨️</Button>
              <View
                className={`voice-button ${isRecording ? 'recording' : ''}`}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchCancel}
              >
                <View className={`voice-text ${isRecording ? 'recording' : ''}`}>
                  {isRecording ? '松开结束' : '按住说话'}
                </View>
                <View className={`recording-indicator ${isRecording ? 'show' : ''}`}>
                  <View className='wave-container'>
                    <View className='wave' />
                    <View className='wave' />
                    <View className='wave' />
                    <View className='wave' />
                    <View className='wave' />
                  </View>
                  <View className='recording-time'>{recordingTime.toString()}</View>
                </View>
              </View>
              <Button className='more-button'>+</Button>
            </>
          ) : (
            <>
              <Button className='mode-switch-button' onClick={toggleInputMode}>🎤</Button>
              <Textarea
                className='text-input'
                value={inputText}
                onInput={handleInput}
                onKeyboardHeightChange={handleKeyboardHeightChange}
                onConfirm={handleSend}
                placeholder='输入消息...'
                showConfirmBar={false}
                adjustPosition={false}
                autoHeight
                confirmType='send'
                fixed
                cursorSpacing={8}
                maxlength={500}
              />
              <Button className='more-button'>+</Button>
            </>
          )}
        </View>
      </View>
    </View>
  )
}

export default ChatPage 
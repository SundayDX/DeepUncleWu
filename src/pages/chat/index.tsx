import React, { useState, useRef, useEffect } from 'react'
import { View, ScrollView, Textarea } from '@tarojs/components'
import { Button } from '@nutui/nutui-react-taro'
import Taro from '@tarojs/taro'
import { useLoad } from '@tarojs/taro'
import './index.scss'

interface Message {
  id: string
  content: string
  type: 'user' | 'ai' | 'system'
  timestamp: number
  voiceUrl?: string // 语音消息的临时文件路径
  duration?: number // 语音消息时长（秒）
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
  const MAX_RECORD_TIME = 60 // 最长录音时长（秒）
  const MIN_PRESS_TIME = 300 // 最短按压时间（毫秒）
  const START_TIMEOUT = 1000 // 录音启动超时时间（毫秒）
  const innerAudioContext = useRef<Taro.InnerAudioContext>()

  // 重置录音状态
  const resetRecordingState = (preserveCancel = false) => {
    console.log('重置录音状态，preserveCancel:', preserveCancel)
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
        console.log('停止录音...')
        recorderManager.current.stop()
      } else {
        console.log('未在录音状态，跳过停止操作')
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
      if (authSetting['scope.record']) {
        setHasRecordPermission(true)
        return true
      }
      const { confirm } = await Taro.showModal({
        title: '需要录音权限',
        content: '请在设置中开启录音权限',
        confirmText: '去设置'
      })
      if (confirm) {
        await Taro.openSetting()
        const { authSetting: newSetting } = await Taro.getSetting()
        setHasRecordPermission(!!newSetting['scope.record'])
        return !!newSetting['scope.record']
      }
      return false
    } catch (error) {
      console.error('检查录音权限失败：', error)
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
      console.log('音频开始播放')
    })
    
    innerAudioContext.current.onEnded(() => {
      console.log('音频播放结束')
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
      console.log('音频准备就绪，可以播放')
    })

    innerAudioContext.current.onWaiting(() => {
      console.log('音频加载中...')
    })

    innerAudioContext.current.onSeeking(() => {
      console.log('音频跳转中...')
    })

    innerAudioContext.current.onSeeked(() => {
      console.log('音频跳转完成')
    })

    return () => {
      innerAudioContext.current?.destroy()
    }
  }, [])

  useEffect(() => {
    // 初始化录音管理器
    recorderManager.current = Taro.getRecorderManager()

    // 监听录音开始事件
    recorderManager.current.onStart(() => {
      console.log('录音开始')
      // 清除启动超时
      if (startTimeoutRef.current) {
        clearTimeout(startTimeoutRef.current)
        startTimeoutRef.current = undefined
      }
      setIsRecording(true)
      isStartingRef.current = false
      Taro.vibrateShort({ type: 'medium' })
      
      // 重置计时
      recordingTimeRef.current = 0
      setRecordingTime(0)
      
      // 开始计时
      recordingTimer.current = setInterval(() => {
        console.log('当前计时状态：', {
          isRecording,
          recordingTimeRef: recordingTimeRef.current,
          recordingTime
        })
        recordingTimeRef.current += 1
        setRecordingTime(prev => prev + 1)
        
        if (recordingTimeRef.current >= MAX_RECORD_TIME) {
          console.log('达到最大录音时长')
          stopRecording()
        }
      }, 1000)
    })

    // 监听录音结束事件
    recorderManager.current.onStop(async (res) => {
      console.log('录音结束，详细信息：', {
        tempFilePath: res.tempFilePath,
        duration: res.duration,
        recordingTimeRef: recordingTimeRef.current,
        fileSize: res.fileSize
      })
      
      // 确保时长至少为1秒
      const finalRecordingTime = Math.max(1, Math.ceil(res.duration / 1000))
      const pressDuration = Date.now() - touchStartTimeRef.current
      console.log('最终按压时长：', pressDuration, 'ms')

      resetRecordingState()

      if (pressDuration < MIN_PRESS_TIME) {
        console.log('按压时间太短')
        Taro.showToast({
          title: '按住时间太短',
          icon: 'none',
          duration: 800
        })
        return
      }
      
      if (finalRecordingTime < MIN_RECORD_TIME) {
        console.log('录音时间太短，实际时长：', finalRecordingTime)
        Taro.showToast({
          title: '说话时间太短：' + finalRecordingTime,
          icon: 'none',
          duration: 800
        })
        return
      }

      try {
        // 保存语音文件
        const savedVoicePath = await saveVoiceFile(res.tempFilePath)

        // 添加录音消息
        const newMessage: Message = {
          id: Date.now().toString(),
          content: `[语音消息 ${finalRecordingTime}秒]`,
          type: 'user',
          timestamp: Date.now(),
          voiceUrl: savedVoicePath,
          duration: finalRecordingTime
        }

        setMessages(prev => [...prev, newMessage])

        // TODO: 这里应该调用语音识别 API
        const aiResponse: Message = {
          id: (Date.now() + 1).toString(),
          content: '我收到了您的语音消息',
          type: 'ai',
          timestamp: Date.now()
        }

        setTimeout(() => {
          setMessages(prev => [...prev, aiResponse])
        }, 1000)
      } catch (error) {
        console.error('保存语音消息失败：', error)
        Taro.showToast({
          title: '保存语音失败',
          icon: 'error',
          duration: 2000
        })
      }
    })

    // 监听录音错误事件
    recorderManager.current.onError((res) => {
      console.error('录音错误，详细信息：', {
        ...res,
        state: {
          isRecording,
          isStarting: isStartingRef.current,
          shouldStart: shouldStartRef.current,
          isCanceled: isCanceledRef.current,
          touchStartTime: touchStartTimeRef.current,
          recordingTime: recordingTimeRef.current
        }
      })
      resetRecordingState()
      Taro.showToast({
        title: `录音失败：${res?.errMsg || '录音错误'}`,
        icon: 'error',
        duration: 2000
      })
    })

    // 监听录音中断事件
    recorderManager.current.onInterruptionBegin(() => {
      console.log('录音被中断')
      if (isRecording) {
        recorderManager.current?.stop()
      }
    })

    // 监听录音恢复事件
    recorderManager.current.onInterruptionEnd(() => {
      console.log('录音中断结束')
    })

    // 初始检查录音权限
    checkRecordPermission()

    // 清理函数
    return () => {
      console.log('组件卸载，清理录音状态')
      if (isRecording) {
        recorderManager.current?.stop()
      }
      resetRecordingState()
    }
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

  // 发送文本消息
  const handleSendMessage = async () => {
    if (!inputText.trim()) return

    const newMessage: Message = {
      id: Date.now().toString(),
      content: inputText,
      type: 'user',
      timestamp: Date.now()
    }

    setMessages(prev => [...prev, newMessage])
    setInputText('')

    // TODO: 调用 AI API
    const aiResponse: Message = {
      id: (Date.now() + 1).toString(),
      content: '这是一个 AI 回复示例',
      type: 'ai',
      timestamp: Date.now()
    }

    setTimeout(() => {
      setMessages(prev => [...prev, aiResponse])
    }, 1000)
  }

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
      console.log('已经在录音中或正在启动录音')
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
      console.log('录音启动超时')
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
        console.log('录音已被取消，不执行启动')
        resetRecordingState(true)
        return
      }

      // 开始录音
      console.log('开始录音...')
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
    console.log('按压时长：', pressDuration, 'ms')

    // 如果按压时间太短，直接取消录音
    if (pressDuration < MIN_PRESS_TIME) {
      console.log('按压时间太短，取消录音')
      shouldStartRef.current = false
      isCanceledRef.current = true
      
      // 只有在真正开始录音或正在启动时才需要停止
      if (isStartingRef.current || isRecording) {
        console.log('取消录音，当前状态：', {
          isRecording,
          isStarting: isStartingRef.current
        })
        stopRecording(true)
      } else {
        console.log('录音尚未开始，直接重置状态')
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
      console.log('不在录音状态且未在启动中，跳过停止操作')
      return
    }

    shouldStartRef.current = false
    console.log('结束录音...')
    stopRecording(false)
  }

  // 取消录音
  const handleTouchCancel = (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!isRecording && !isStartingRef.current) {
      console.log('不在录音状态且未在启动中，跳过取消操作')
      return
    }

    shouldStartRef.current = false
    isCanceledRef.current = true
    console.log('取消录音，当前状态：', {
      isRecording,
      isStarting: isStartingRef.current
    })
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
  const handleSend = (e) => {
    if (e.detail.value.trim()) {
      const newMessage: Message = {
        id: Date.now().toString(),
        content: e.detail.value.trim(),
        type: 'user',
        timestamp: Date.now()
      }

      setMessages(prev => [...prev, newMessage])
      setInputText('')

      // TODO: 调用 AI API
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        content: '这是一个 AI 回复示例',
        type: 'ai',
        timestamp: Date.now()
      }

      setTimeout(() => {
        setMessages(prev => [...prev, aiResponse])
      }, 1000)
    }
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
            console.log('语音文件保存成功：', res)
            resolve(res)
          },
          fail: (error) => {
            console.error('语音文件保存失败：', error)
            reject(error)
          }
        })
      })

      console.log('语音文件已保存到：', savedPath)
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
        console.log('停止播放当前语音')
        innerAudioContext.current?.stop()
        setPlayingMessageId(null)
        return
      }

      // 如果正在播放其他消息，先停止
      if (playingMessageId) {
        console.log('停止播放其他语音')
        innerAudioContext.current?.stop()
      }

      // 检查文件是否存在
      const fs = Taro.getFileSystemManager()
      await new Promise<void>((resolve, reject) => {
        fs.access({
          path: message.voiceUrl!,
          success: () => {
            console.log('语音文件存在，可以访问')
            // 读取文件内容以验证
            fs.readFile({
              filePath: message.voiceUrl!,
              success: (res) => {
                console.log('成功读取语音文件，文件大小：', (res.data as ArrayBuffer).byteLength)
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
        console.log('音频开始播放')
      })
      
      innerAudioContext.current.onEnded(() => {
        console.log('音频播放结束')
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
        console.log('音频准备就绪，可以播放')
      })

      innerAudioContext.current.onTimeUpdate(() => {
        console.log('播放进度更新：', innerAudioContext.current?.currentTime)
      })

      // 设置音频源并播放
      console.log('设置音频源：', message.voiceUrl)
      innerAudioContext.current.src = message.voiceUrl

      // 开始播放
      console.log('开始播放音频')
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
                    {message.voiceUrl ? (
                      <View 
                        className={`message-content voice-message ${playingMessageId === message.id ? 'playing' : ''}`}
                        onClick={() => handlePlayVoice(message)}
                      >
                        <View className='voice-content'>
                          {message.type === 'user' ? (
                            <>
                              <View className='voice-duration'>{message.duration}″</View>
                              <View className='voice-wave'>
                                <View className='wave-line' />
                                <View className='wave-line' />
                                <View className='wave-line' />
                              </View>
                            </>
                          ) : (
                            <>
                              <View className='voice-wave reverse'>
                                <View className='wave-line' />
                                <View className='wave-line' />
                                <View className='wave-line' />
                              </View>
                              <View className='voice-duration'>{message.duration}″</View>
                            </>
                          )}
                        </View>
                      </View>
                    ) : (
                      <View className='message-content'>{message.content}</View>
                    )}
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
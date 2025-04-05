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
}

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${hours}:${minutes}`
}

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
  const messageListRef = useRef<Message[]>(messages)
  const recorderManager = useRef<Taro.RecorderManager>()
  const recordingTimer = useRef<NodeJS.Timeout>()
  const recordingTimeRef = useRef(0) // 添加一个 ref 来跟踪实际的录音时长
  const MIN_RECORD_TIME = 1 // 最短录音时长（秒）
  const MAX_RECORD_TIME = 60 // 最长录音时长（秒）

  // 重置录音状态
  const resetRecordingState = () => {
    console.log('重置录音状态')
    setIsRecording(false)
    if (recordingTimer.current) {
      clearInterval(recordingTimer.current)
      recordingTimer.current = undefined
    }
    setRecordingTime(0)
    recordingTimeRef.current = 0
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

  useEffect(() => {
    // 初始化录音管理器
    recorderManager.current = Taro.getRecorderManager()

    // 监听录音开始事件
    recorderManager.current.onStart(() => {
      console.log('录音开始')
      setIsRecording(true)
      Taro.vibrateShort({ type: 'medium' })
      
      // 重置计时
      recordingTimeRef.current = 0
      setRecordingTime(0)
      
      // 开始计时
      recordingTimer.current = setInterval(() => {
        recordingTimeRef.current += 1
        console.log('计时：', recordingTimeRef.current)
        setRecordingTime(recordingTimeRef.current)
        
        if (recordingTimeRef.current >= MAX_RECORD_TIME) {
          console.log('达到最大录音时长')
          recorderManager.current?.stop()
        }
      }, 1000)
    })

    // 监听录音结束事件
    recorderManager.current.onStop(async (res) => {
      console.log('录音结束，文件路径：', res.tempFilePath)
      console.log('当前录音时长：', recordingTimeRef.current)
      
      // 保存当前录音时长
      const finalRecordingTime = recordingTimeRef.current
      
      // 检查录音时长
      if (finalRecordingTime < MIN_RECORD_TIME) {
        console.log('录音时间太短')
        Taro.showToast({
          title: '说话时间太短：' + finalRecordingTime,
          icon: 'none',
          duration: 1500
        })
        resetRecordingState()
        return
      }

      // 添加录音消息
      const newMessage: Message = {
        id: Date.now().toString(),
        content: `[语音消息 ${finalRecordingTime}秒]`,
        type: 'user',
        timestamp: Date.now()
      }

      setMessages(prev => [...prev, newMessage])
      
      // 重置录音状态
      resetRecordingState()

      // TODO: 这里应该调用语音识别 API
      // 模拟 AI 回复
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        content: '我收到了您的语音消息',
        type: 'ai',
        timestamp: Date.now()
      }

      setTimeout(() => {
        setMessages(prev => [...prev, aiResponse])
      }, 1000)
    })

    // 监听录音错误事件
    recorderManager.current.onError((res) => {
      console.error('录音错误：', res)
      resetRecordingState()
      Taro.showToast({
        title: '录音失败',
        icon: 'error',
        duration: 1500
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
    
    if (isRecording) {
      console.log('已经在录音中')
      return
    }

    // 检查录音权限
    const hasPermission = await checkRecordPermission()
    if (!hasPermission) {
      console.log('没有录音权限')
      return
    }

    try {
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
      console.error('开始录音失败：', error)
      resetRecordingState()
      Taro.showToast({
        title: '录音失败',
        icon: 'error',
        duration: 1500
      })
    }
  }

  // 结束录音
  const handleTouchEnd = (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!isRecording) {
      console.log('不在录音状态')
      return
    }

    console.log('结束录音...')
    try {
      recorderManager.current?.stop()
    } catch (error) {
      console.error('停止录音失败：', error)
      resetRecordingState()
      Taro.showToast({
        title: '录音失败',
        icon: 'error',
        duration: 1500
      })
    }
  }

  // 取消录音
  const handleTouchCancel = (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!isRecording) {
      return
    }

    resetRecordingState()
    try {
      recorderManager.current?.stop()
    } catch (error) {
      console.error('取消录音失败：', error)
    }
    
    Taro.showToast({
      title: '已取消',
      icon: 'none',
      duration: 1500
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
                    <View className='message-content'>{message.content}</View>
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
              <Button
                className={`voice-button ${isRecording ? 'recording' : ''}`}
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
              </Button>
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
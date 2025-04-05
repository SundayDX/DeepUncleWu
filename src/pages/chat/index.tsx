import React, { useState, useRef, useEffect } from 'react'
import { View, ScrollView } from '@tarojs/components'
import { Button, Input } from '@nutui/nutui-react-taro'
import Taro from '@tarojs/taro'
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
  const messageListRef = useRef<Message[]>(messages)
  const recorderManager = useRef<Taro.RecorderManager>()

  useEffect(() => {
    // 初始化录音管理器
    recorderManager.current = Taro.getRecorderManager()

    // 监听录音结束事件
    recorderManager.current.onStop((res) => {
      console.log('录音文件：', res.tempFilePath)
      // TODO: 处理录音文件，发送到语音识别 API
    })

    // 监听录音错误事件
    recorderManager.current.onError((res) => {
      console.error('录音错误：', res)
      Taro.showToast({
        title: '录音失败',
        icon: 'error'
      })
    })
  }, [])

  // 自动滚动到底部
  useEffect(() => {
    messageListRef.current = messages
    // 使用 nextTick 确保在 DOM 更新后滚动
    Taro.nextTick(() => {
      setScrollTop(prev => prev + 9999)
    })
  }, [messages])

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
  const handleStartRecording = () => {
    // 检查录音权限
    Taro.getSetting({
      success: (res) => {
        if (!res.authSetting['scope.record']) {
          Taro.authorize({
            scope: 'scope.record',
            success: () => {
              startRecording()
            },
            fail: () => {
              Taro.showModal({
                title: '需要录音权限',
                content: '请在小程序设置中开启录音权限',
                confirmText: '去设置',
                success: (modalRes) => {
                  if (modalRes.confirm) {
                    Taro.openSetting()
                  }
                }
              })
            }
          })
        } else {
          startRecording()
        }
      }
    })
  }

  // 实际开始录音的函数
  const startRecording = () => {
    setIsRecording(true)
    recorderManager.current?.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 96000,
      format: 'mp3',
      frameSize: 50
    })
  }

  // 结束录音
  const handleStopRecording = () => {
    setIsRecording(false)
    recorderManager.current?.stop()
  }

  return (
    <View className='chat-page'>
      <ScrollView
        className='message-list'
        scrollY
        scrollTop={scrollTop}
        scrollWithAnimation
        enhanced
        bounces={false}
        showScrollbar={false}
      >
        {messages.map(message => (
          <View
            key={message.id}
            className={`message-item ${message.type === 'user' ? 'user' : message.type === 'ai' ? 'ai' : 'system'}`}
          >
            <View className='avatar'>
              {message.type === 'user' ? '👤' : message.type === 'ai' ? '🤖' : '🤖'}
            </View>
            <View className='message-wrapper'>
              <View className='message-content'>{message.content}</View>
              <View className='message-time'>{formatTime(message.timestamp)}</View>
            </View>
          </View>
        ))}
      </ScrollView>

      <View className='input-area'>
        <View className='input-box'>
          <Button
            className='mode-switch-button'
            type='default'
            onClick={toggleInputMode}
          >
            {isVoiceMode ? '⌨️' : '🎤'}
          </Button>
          {isVoiceMode ? (
            <Button
              className='voice-button'
              type='default'
              onTouchStart={handleStartRecording}
              onTouchEnd={handleStopRecording}
            >
              <View className={`voice-text ${isRecording ? 'recording' : ''}`}>
                {isRecording ? '松开结束' : '按住说话'}
              </View>
            </Button>
          ) : (
            <>
              <Input
                className='text-input'
                value={inputText}
                onChange={(val) => setInputText(val)}
                placeholder='输入消息...'
              />
              <Button
                className='send-button'
                type='primary'
                onClick={handleSendMessage}
                disabled={!inputText.trim()}
              >
                发送
              </Button>
            </>
          )}
        </View>
      </View>
    </View>
  )
}

export default ChatPage 
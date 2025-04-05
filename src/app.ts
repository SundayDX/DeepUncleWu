import { Component, PropsWithChildren } from 'react'
import { useDidShow, useDidHide } from '@tarojs/taro'
import '@nutui/nutui-react-taro/dist/style.css'
// 全局样式
import './app.scss'

function App({ children }: PropsWithChildren<any>) {
  // 对应 onShow
  useDidShow(() => {
    console.log('App onShow')
  })

  // 对应 onHide
  useDidHide(() => {
    console.log('App onHide')
  })

  return children
}

export default App

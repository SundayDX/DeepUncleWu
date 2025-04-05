export default defineAppConfig({
  pages: [
    'pages/chat/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#07c160',
    navigationBarTitleText: '智能强叔',
    navigationBarTextStyle: 'white'
  },
  permission: {
    'scope.record': {
      desc: '录音功能用于语音输入'
    }
  }
})

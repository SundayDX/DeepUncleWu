export default defineAppConfig({
  pages: [
    'pages/chat/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: '智能强叔',
    navigationBarTextStyle: 'black'
  },
  permission: {
    'scope.record': {
      desc: '录音功能用于语音交互'
    }
  },
  requiredPrivateInfos: [
    'getLocation',
    'chooseLocation',
    'onLocationChange',
    'startLocationUpdateBackground',
    'chooseAddress'
  ]
})

module.exports = function (RED) {
  'use strict'
  const TasmotaBase = require('./tasmota_base.js')

  const SWITCH_DEFAULTS = {
    idx: 0,
    supportPulseTime: false,
    supportChangeTime: false
  }

  class TasmotaSwitch extends TasmotaBase {
    constructor (userConfig) {
      super(userConfig, RED, SWITCH_DEFAULTS)
      this.switch = this.deviceNode.swiches[this.config.idx]
      if (this.config.supportPulseTime) this.switch.supportPulseTime = true
    }

    onNodeInput (msg) {
      let payload = msg.payload
      const topic = (msg.topic || '').toLowerCase()
      
      //avoid deadlocks
      if (msg.device && (this.deviceNode.config.device === msg.device)) return

      if (topic.startsWith('timeout')) {
        if (!this.config.supportPulseTime) return
        const channel = this.extractChannelNum(topic)
        this.switch.requestTimer(payload.toString())
        return
      }

      if (topic.startsWith('switch') && (this.extractChannelNum(topic) !== this.config.idx + 1)) return

      // Switch On/Off for booleans and 1/0 (int or str)
      if ((payload === true) || (payload === 1) || (payload === '1')) payload = true
      else if ((payload === false) || (payload === 0) || (payload === '0')) payload = false

      // String payload: on/off, true/false, toggle (not case sensitive)
      else if (typeof payload === 'string') {
        switch (payload.toLowerCase()) {
          case 'on':
          case 'true':
            payload = true
            break
          case 'off':
          case 'false':
            payload = false
            break
          case 'toggle':
            payload = !this.switch.lastValue
            break
          default:
            this.warn('Invalid payload received on input' + JSON.stringify(msg))
            return
        }
      }
      else {
        this.warn('Invalid payload received on input' + JSON.stringify(msg))
        return
      }
      this.switch.setPower(payload)
    }

    onSend(msg) {
      msg.payload = this.switch.lastValue
      if (this.config.supportChangeTime) msg.time = this.switch.lastChangeTime.toLocaleString()
      switch(msg.topic) {
        case 'switch':
          // update status icon and label
          if (this.switch.lastValue) this.setNodeStatus('green', 'On')
          else  this.setNodeStatus('grey', 'Off')
          break
      }
      super.onSend(msg)
    }
  }

  RED.nodes.registerType('tasmota-switch', TasmotaSwitch)
}

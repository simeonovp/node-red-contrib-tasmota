module.exports = function (RED) {
  'use strict'
  const BaseTasmotaNode = require('./base_tasmota.js')

  const SWITCH_DEFAULTS = {
    supportPulseTime: false,
    countdownPolling: '0'
  }

  // values for the tasmota POWER command
  const onValue = 'ON'
  const offValue = 'OFF'
  const toggleValue = 'TOGGLE'

  class TasmotaSwitchNode extends BaseTasmotaNode {
    constructor (userConfig) {
      super(userConfig, RED, SWITCH_DEFAULTS)
      this.cache = [] // switch status cache, es: [1=>'On', 2=>'Off']
      this.polling = parseInt(this.config.countdownPolling | '0')
      this.swichCount = 0
      this.timeouts = []
      this.timers = []
      this.supportChangeTime = userConfig.supportChangeTime

      // Subscribes to state change of all the switch  stat/<device>/+
      this.MQTTSubscribe('stat', '+', (topic, payload) => {
        this.onStat(topic, payload)
      })

      this.on('close', done => {
        this.onClose()
        done()
      })
    }

    onDeviceOnline () {
      // Publish a start command to get the state of all the switches
      this.MQTTPublish('cmnd', 'POWER0')
      this.swichCount = 0
      if (this.config.supportPulseTime) {
        // supportPulseTime is possible only in single output mode
        if (this.config.outputs !== 1 && this.config.outputs !== '1') {
          this.config.supportPulseTime = false
          return
        }
      }
    }

    onClose() {
      for(let idx in this.timers) if (this.timers[idx]) clearInterval(idx)
    }

    onNodeInput (msg) {
      const payload = msg.payload
      const topic = msg.topic || 'switch1'
      
      if (topic.toLowerCase().startsWith('timeout')) {
        if (!this.config.supportPulseTime) return
        const channel = this.extractChannelNum(topic)
        if (payload) {
          const sec = parseInt(payload.toString())
          const value = (sec > 11) ? (sec + 100) : (sec * 10)
          //this.timeouts[channel - 1] = value
          this.requestTimer(channel, value.toString())
        }
        else {
          this.requestTimer(channel)
        }
        return
      }

      const channel = topic.toLowerCase().startsWith('switch') ? this.extractChannelNum(topic) : 1
      const command = 'POWER' + channel

      // Switch On/Off for booleans and 1/0 (int or str)
      if (payload === true || payload === 1 || payload === '1') {
        this.MQTTPublish('cmnd', command, onValue)
        return
      }
      if (payload === false || payload === 0 || payload === '0') {
        this.MQTTPublish('cmnd', command, offValue)
        return
      }

      // String payload: on/off, true/false, toggle (not case sensitive)
      if (typeof payload === 'string') {
        switch (payload.toLowerCase()) {
          case 'on':
          case 'true':
            this.MQTTPublish('cmnd', command, onValue)
            return
          case 'off':
          case 'false':
            this.MQTTPublish('cmnd', command, offValue)
            return
          case 'toggle':
            this.MQTTPublish('cmnd', command, toggleValue)
            return
        }
      }

      this.warn('Invalid payload received on input')
    }

    onStat (mqttTopic, mqttPayloadBuf) {
      // last part of the topic must be POWER or POWERx (ignore any others)
      const lastTopic = mqttTopic.split('/').pop()
      if (!lastTopic.startsWith('POWER')) {
        if (this.config.supportPulseTime) {
          if (lastTopic !== 'RESULT') return
          const result = JSON.parse(mqttPayloadBuf.toString())
          if (!result) return
          Object.keys(result).forEach(key => {
            if (!key.startsWith('PulseTime')) return
            const channel = this.extractChannelNum(key)
            const PulseTime = result[key]
            if (PulseTime) {
              if (PulseTime.Set !== null) {
                const sec = this.parseSeconds(PulseTime.Set)
                if (this.timeouts[channel - 1] !== sec) {
                  this.timeouts[channel - 1] = sec
                  this.send({topic: 'timeout' + channel, payload: sec})
                }
              }
              if (this.polling) {
                if (PulseTime.Remaining !== null) {
                  const sec = this.parseSeconds(PulseTime.Remaining)
                  //this.send({topic: 'info', payload: 'sec=' + sec}) //sip--
                  if(sec) this.send({topic: 'countdown' + channel, payload: sec})
                  else if(this.timers[channel - 1]) this.stopTimer(channel)
                }
              }
              //this.send({topic: 'info', payload: this.polling + '(' + typeof this.polling + ')'}) //sip--
            }
          })
        }
        return
      }

      // check payload is valid
      const mqttPayload = mqttPayloadBuf.toString()
      let status
      let isOn = false
      if (mqttPayload === onValue) {
        status = 'On'
        isOn = true
      } else if (mqttPayload === offValue) {
        status = 'Off'
      } else {
        return
      }

      // extract channel number and save in cache
      const channel = this.extractChannelNum(lastTopic)
      this.cache[channel - 1] = status

      if (this.config.supportPulseTime) {
        if (!isOn) this.stopTimer(channel)
        else if (!this.timers[channel - 1]) this.startTimer(channel)
      }

      // update status icon and label
      this.setNodeStatus(this.cache[0] === 'On' ? 'green' : 'grey', this.cache.join(' - '))

      // build and send the new boolen message for topic 'switchX'
      let msg = { topic: 'switch' + channel, payload: isOn }
      if (this.supportChangeTime) msg.time = new Date().toLocaleString()

      if (this.config.outputs === 1 || this.config.outputs === '1') {
        // everything to the same (single) output
        this.send(msg)
      } else {
        // or send to the correct output
        const msgList = Array(this.config.outputs).fill(null)
        msgList[channel - 1] = msg
        this.send(msgList)
      }

      if (channel > this.swichCount) {
        // Tamota not supports command PulseTime0 similar to POWER0
        // use auto recognation instead
        if (this.config.supportPulseTime) {
          for (let i = this.swichCount + 1; i <= channel; i++) {
            this.requestTimer(i)
          }
        }
        this.swichCount = channel
      }
    }

    parseSeconds(val) {
      return (val > 110) ? (val - 100) : parseInt(val / 10);
    }

    requestTimer(channel, val) {
      this.MQTTPublish('cmnd', 'PulseTime' + channel, val)
    }

    startTimer(channel) {
      if (!this.polling && !this.timeouts[channel - 1]) return;
      if (this.timers[channel - 1]) this.clearInterval(this.timers[channel - 1])
      this.timers[channel - 1] = setInterval(()=>{ 
        this.requestTimer(channel)
      }, this.polling * 1000);
    }

    stopTimer(channel) {
      if (this.timers[channel - 1]) {
        clearInterval(this.timers[channel - 1])
        this.timers[channel - 1] = null
      }
      this.send({topic: 'countdown' + channel, payload: 0})
    }
  }

  RED.nodes.registerType('Tasmota Switch', TasmotaSwitchNode)
}

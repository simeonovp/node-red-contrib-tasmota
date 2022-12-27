module.exports = function (RED) {
  'use strict'
  const TasmotaBase = require('./tasmota_base.js')

  const BUTTON_DEFAULTS = {
    // no specific options for this node
    idx: 0
  }

  class TasmotaButton extends TasmotaBase {
    constructor (userConfig) {
      super(userConfig, RED, BUTTON_DEFAULTS)

      // Subscribes to stat info for all the buttons  stat/<device>/+
      this.MQTTSubscribe('stat', '+', (topic, payload) => {
        this.onStat(topic, payload)
      })
    }

    onStat (mqttTopic, mqttPayloadBuf) {
      this.log('-- onStat')
      let channel = null
      let action = null
      let payload = null
      const lastTopic = mqttTopic.split('/').pop()
      try {
        payload = JSON.parse(mqttPayloadBuf.toString())
      } catch (e) {
        return // ignore any non-json payload
      }

      /* Firmware >= 9.1.0
         stat/topic/RESULT = {"Button<X>":{"Action":"SINGLE"}}
         stat/topic/RESULT = {"Switch<X>":{"Action":"SINGLE"}}
      */
      if (lastTopic === 'RESULT') {
        for (const [key, value] of Object.entries(payload)) {
          if (key.startsWith('Button') || key.startsWith('Switch')) {
            channel = this.extractChannelNum(key)
            action = value.Action
          }
        }
      } 
      /* Firmware < 9.1.0
         stat/topic/BUTTON<X> = {"ACTION":"DOUBLE"}
      */
      else if (lastTopic.startsWith('BUTTON')) {
        channel = this.extractChannelNum(lastTopic)
        action = payload.ACTION
      }

      // something usefull received ?
      if (!channel || !action || (channel !== (this.config.idx + 1))) return

      this.log('-- onStat match')

      // update status icon and label
      this.setNodeStatus('green', `${action} (${channel})`)

      // send the new string message for topic 'buttonX'
      this.send({ topic: 'button' + channel, payload: action })
    }
  }

  RED.nodes.registerType('tasmota-button', TasmotaButton)
}

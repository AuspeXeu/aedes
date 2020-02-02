'use strict'

var { test } = require('tap')
var http = require('http')
var ws = require('websocket-stream')
var mqtt = require('mqtt')
var mqttPacket = require('mqtt-packet')
var net = require('net')
var proxyProtocol = require('proxy-protocol-js')
var { setup, connect, delay } = require('./helper')
var aedes = require('../')

;[{ ver: 3, id: 'MQIsdp' }, { ver: 4, id: 'MQTT' }].forEach(function (ele) {
  test('connect and connack (minimal)', function (t) {
    t.plan(1)

    var s = setup()
    t.tearDown(s.broker.close.bind(s.broker))

    s.inStream.write({
      cmd: 'connect',
      protocolId: ele.id,
      protocolVersion: ele.ver,
      clean: true,
      clientId: 'my-client',
      keepalive: 0
    })

    s.outStream.on('data', function (packet) {
      t.deepEqual(packet, {
        cmd: 'connack',
        returnCode: 0,
        length: 2,
        qos: 0,
        retain: false,
        dup: false,
        topic: null,
        payload: null,
        sessionPresent: false
      }, 'successful connack')
    })
  })
})

// [MQTT-3.1.2-2]
test('reject client requested for unacceptable protocol version', function (t) {
  t.plan(4)

  var broker = aedes()
  t.tearDown(broker.close.bind(broker))

  var s = setup(broker)

  s.inStream.write({
    cmd: 'connect',
    protocolId: 'MQIsdp',
    protocolVersion: 5,
    clean: true,
    clientId: 'my-client',
    keepalive: 0
  })
  s.outStream.on('data', function (packet) {
    t.equal(packet.cmd, 'connack')
    t.equal(packet.returnCode, 1, 'unacceptable protocol version')
    t.equal(broker.connectedClients, 0)
  })
  broker.on('clientError', function (client, err) {
    t.fail('should not raise clientError error')
  })
  broker.on('connectionError', function (client, err) {
    t.equal(err.message, 'unacceptable protocol version')
  })
})

// [MQTT-3.1.2-1], Guarded in mqtt-packet
test('reject client requested for unsupported protocol version', function (t) {
  t.plan(2)

  var broker = aedes()
  t.tearDown(broker.close.bind(broker))

  var s = setup(broker)

  s.inStream.write({
    cmd: 'connect',
    protocolId: 'MQTT',
    protocolVersion: 2,
    clean: true,
    clientId: 'my-client',
    keepalive: 0
  })
  s.outStream.on('data', function (packet) {
    t.fail('no data sent')
  })
  broker.on('connectionError', function (client, err) {
    t.equal(err.message, 'Invalid protocol version')
    t.equal(broker.connectedClients, 0)
  })
})

// Guarded in mqtt-packet
test('reject clients with no clientId running on MQTT 3.1.0', function (t) {
  t.plan(2)

  var broker = aedes()
  t.tearDown(broker.close.bind(broker))

  var s = setup(broker)

  s.inStream.write({
    cmd: 'connect',
    protocolId: 'MQIsdp',
    protocolVersion: 3,
    clean: true,
    keepalive: 0
  })
  s.outStream.on('data', function (packet) {
    t.fail('no data sent')
  })
  broker.on('connectionError', function (client, err) {
    t.equal(err.message, 'clientId must be supplied before 3.1.1')
    t.equal(broker.connectedClients, 0)
  })
})

// [MQTT-3.1.3-7], Guarded in mqtt-packet
test('reject clients without clientid and clean=false on MQTT 3.1.1', function (t) {
  t.plan(2)

  var broker = aedes()
  t.tearDown(broker.close.bind(broker))

  var s = setup(broker)

  s.inStream.write({
    cmd: 'connect',
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: false,
    clientId: '',
    keepalive: 0
  })
  s.outStream.on('data', function (packet) {
    t.fail('no data sent')
  })
  broker.on('connectionError', function (client, err) {
    t.equal(err.message, 'clientId must be given if cleanSession set to 0')
    t.equal(broker.connectedClients, 0)
  })
})

test('clients without clientid and clean=true on MQTT 3.1.1 will get a generated clientId', function (t) {
  t.plan(4)

  var broker = aedes()
  t.tearDown(broker.close.bind(broker))

  var s = setup(broker)

  s.inStream.write({
    cmd: 'connect',
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    keepalive: 0
  })
  s.outStream.on('data', function (packet) {
    t.equal(packet.cmd, 'connack')
    t.equal(packet.returnCode, 0)
    t.equal(broker.connectedClients, 1)
  })
  broker.on('connectionError', function (client, err) {
    t.error(err, 'no error')
  })
  broker.on('client', function (client) {
    t.ok(client.id.startsWith('aedes_'))
  })
})

test('clients with zero-byte clientid and clean=true on MQTT 3.1.1 will get a generated clientId', function (t) {
  t.plan(4)

  var broker = aedes()
  t.tearDown(broker.close.bind(broker))

  var s = setup(broker)

  s.inStream.write({
    cmd: 'connect',
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    clientId: '',
    keepalive: 0
  })
  s.outStream.on('data', function (packet) {
    t.equal(packet.cmd, 'connack')
    t.equal(packet.returnCode, 0)
    t.equal(broker.connectedClients, 1)
  })
  broker.on('connectionError', function (client, err) {
    t.error(err, 'no error')
  })
  broker.on('client', function (client) {
    t.ok(client.id.startsWith('aedes_'))
  })
})

// [MQTT-3.1.3-7]
test('reject clients with > 23 clientId length in MQTT 3.1.0', function (t) {
  t.plan(4)

  var broker = aedes()
  t.tearDown(broker.close.bind(broker))

  var s = setup(broker)

  s.inStream.write({
    cmd: 'connect',
    protocolId: 'MQIsdp',
    protocolVersion: 3,
    clean: true,
    clientId: 'abcdefghijklmnopqrstuvwxyz',
    keepalive: 0
  })
  s.outStream.on('data', function (packet) {
    t.equal(packet.cmd, 'connack')
    t.equal(packet.returnCode, 2, 'identifier rejected')
    t.equal(broker.connectedClients, 0)
  })
  broker.on('connectionError', function (client, err) {
    t.equal(err.message, 'identifier rejected')
  })
})

test('connect with > 23 clientId length in MQTT 3.1.1', function (t) {
  t.plan(3)

  var broker = aedes()
  t.tearDown(broker.close.bind(broker))

  var s = setup(broker)

  s.inStream.write({
    cmd: 'connect',
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    clientId: 'abcdefghijklmnopqrstuvwxyz',
    keepalive: 0
  })
  s.outStream.on('data', function (packet) {
    t.equal(packet.cmd, 'connack')
    t.equal(packet.returnCode, 0)
    t.equal(broker.connectedClients, 1)
  })
  broker.on('connectionError', function (client, err) {
    t.error(err, 'no error')
  })
})

// [MQTT-3.1.0-1]
test('the first Packet MUST be a CONNECT Packet', function (t) {
  t.plan(2)

  var broker = aedes()
  t.tearDown(broker.close.bind(broker))

  var packet = {
    cmd: 'publish',
    topic: 'hello',
    payload: Buffer.from('world'),
    qos: 0,
    retain: false
  }
  var s = setup(broker)
  s.inStream.write(packet)

  broker.on('connectionError', function (client, err) {
    t.equal(err.message, 'Invalid protocol')
  })
  setImmediate(() => {
    t.ok(s.conn.destroyed, 'close connection if first packet is not a CONNECT')
    s.conn.destroy()
  })
})

// [MQTT-3.1.0-2]
test('second CONNECT Packet sent from a Client as a protocol violation and disconnect the Client', function (t) {
  t.plan(4)

  var broker = aedes()
  t.tearDown(broker.close.bind(broker))

  var packet = {
    cmd: 'connect',
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    clientId: 'my-client',
    keepalive: 0
  }
  broker.on('clientError', function (client, err) {
    t.equal(err.message, 'Invalid protocol')
  })
  var s = connect(setup(broker), { clientId: 'abcde' }, function () {
    t.ok(broker.clients.abcde.connected)
    // destory client when there is a 2nd cmd:connect, even the clientId is dfferent
    s.inStream.write(packet)
    setImmediate(() => {
      t.equal(broker.clients.abcde, undefined, 'client instance is removed')
      t.ok(s.conn.destroyed, 'close connection if packet is a CONNECT after network is established')
    })
  })
})

test('reject second CONNECT Packet sent while first CONNECT still in preConnect stage', function (t) {
  t.plan(2)

  var packet1 = {
    cmd: 'connect',
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    clientId: 'my-client-1',
    keepalive: 0
  }
  var packet2 = {
    cmd: 'connect',
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    clientId: 'my-client-2',
    keepalive: 0
  }

  var i = 0
  var broker = aedes({
    preConnect: function (client, done) {
      var ms = i++ === 0 ? 2000 : 500
      setTimeout(function () {
        done(null, true)
      }, ms)
    }
  })
  t.tearDown(broker.close.bind(broker))

  var s = setup(broker)

  broker.on('connectionError', function (client, err) {
    t.equal(err.info.clientId, 'my-client-2')
    t.equal(err.message, 'Invalid protocol')
  })

  const msg = async (s, ms, msg) => {
    await delay(ms)
    s.inStream.write(msg)
  }

  ;(async () => {
    await Promise.all([msg(s, 100, packet1), msg(s, 200, packet2)])
  })().catch(
    (error) => {
      t.fail(error)
    }
  )
})

// [MQTT-3.1.2-1], Guarded in mqtt-packet
test('reject clients with wrong protocol name', function (t) {
  t.plan(2)

  var broker = aedes()
  t.tearDown(broker.close.bind(broker))

  var s = setup(broker)

  s.inStream.write({
    cmd: 'connect',
    protocolId: 'MQTT_hello',
    protocolVersion: 3,
    clean: true,
    clientId: 'my-client',
    keepalive: 0
  })
  s.outStream.on('data', function (packet) {
    t.fail('no data sent')
  })
  broker.on('connectionError', function (client, err) {
    t.equal(err.message, 'Invalid protocolId')
    t.equal(broker.connectedClients, 0)
  })
})

test('After first CONNECT Packet, others are queued until \'connect\' event', function (t) {
  t.plan(2)

  var queueLimit = 50
  var broker = aedes({ queueLimit })
  t.tearDown(broker.close.bind(broker))

  var publishP = {
    cmd: 'publish',
    topic: 'hello',
    payload: Buffer.from('world'),
    qos: 0,
    retain: false
  }

  var connectP = {
    cmd: 'connect',
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    clientId: 'abcde',
    keepalive: 0
  }

  var s = setup(broker)
  s.inStream.write(connectP)

  process.once('warning', e => t.fail('Memory leak detected'))

  for (let i = 0; i < queueLimit; i++) {
    s.inStream.write(publishP)
  }

  broker.on('client', function (client) {
    t.equal(client._parser._queue.length, queueLimit, 'Packets have been queued')

    client.once('connected', () => {
      t.equal(client._parser._queue, null, 'Queue is empty')
      s.conn.destroy()
    })
  })
})

test('Test queue limit', function (t) {
  t.plan(1)

  var queueLimit = 50
  var broker = aedes({ queueLimit })
  t.tearDown(broker.close.bind(broker))

  var publishP = {
    cmd: 'publish',
    topic: 'hello',
    payload: Buffer.from('world'),
    qos: 0,
    retain: false
  }

  var connectP = {
    cmd: 'connect',
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    clientId: 'abcde',
    keepalive: 0
  }

  var s = setup(broker)
  s.inStream.write(connectP)

  process.once('warning', e => t.fail('Memory leak detected'))

  for (let i = 0; i < queueLimit + 1; i++) {
    s.inStream.write(publishP)
  }

  broker.on('connectionError', function (conn, err) {
    t.equal(err.message, 'Client queue limit reached', 'Queue error is thrown')
    s.conn.destroy()
  })
})

;[[0, null, false], [0, null, true], [1, new Error('connection banned'), false], [1, new Error('connection banned'), true]].forEach(function (ele, idx) {
  var plan = ele[0]
  var err = ele[1]
  var ok = ele[2]
  test('preConnect handler', function (t) {
    t.plan(plan)

    var broker = aedes({
      preConnect: function (client, done) {
        return done(err, ok)
      }
    })
    t.tearDown(broker.close.bind(broker))

    var s = setup(broker)

    s.inStream.write({
      cmd: 'connect',
      protocolId: 'MQTT',
      protocolVersion: 4,
      clean: true,
      clientId: 'my-client-' + idx,
      keepalive: 0
    })
    broker.on('client', function (client) {
      if (ok) {
        t.pass('connect ok')
      } else {
        t.fail('no reach here')
      }
    })
    broker.on('clientError', function (client, err) {
      t.fail('no client error')
    })
    broker.on('connectionError', function (client, err) {
      if (err) {
        t.equal(err.message, 'connection banned')
      } else {
        t.fail('no connection error')
      }
    })
  })
})

// websocket-stream based connections
test('websocket clients have access to the request object', function (t) {
  t.plan(3)

  var port = 4883
  var broker = aedes()
  broker.on('client', function (client) {
    if (client.req) {
      t.pass('client request object present')
      if (client.req.headers) {
        t.equal('sample', client.req.headers['x-test-protocol'])
      }
    } else {
      t.fail('no request object present')
    }
  })

  var server = http.createServer()
  ws.createServer({
    server: server
  }, broker.handle)

  server.listen(port, function (err) {
    t.error(err, 'no error')
  })

  var client = mqtt.connect(`ws://localhost:${port}`, {
    wsOptions: {
      headers: {
        'X-Test-Protocol': 'sample'
      }
    }
  })

  t.tearDown(() => {
    client.end(true)
    broker.close()
    server.close()
  })
})

// test ipAddress property presence when trustProxy is enabled
test('tcp clients have access to the ipAddress from the socket', function (t) {
  t.plan(2)

  var port = 4883
  var broker = aedes({
    preConnect: function (client, done) {
      if (client && client.connDetails && client.connDetails.ipAddress) {
        client.ip = client.connDetails.ipAddress
        t.equal('::ffff:127.0.0.1', client.ip)
      } else {
        t.fail('no ip address present')
      }
      done(null, true)
    },
    trustProxy: true
  })

  var server = net.createServer(broker.handle)
  server.listen(port, function (err) {
    t.error(err, 'no error')
  })

  var client = mqtt.connect({
    port,
    keepalive: 0,
    clientId: 'mqtt-client',
    clean: false
  })

  t.tearDown(() => {
    client.end(true)
    broker.close()
    server.close()
  })
})

test('tcp proxied (protocol v1) clients have access to the ipAddress(v4)', function (t) {
  t.plan(2)

  var port = 4883
  var clientIp = '192.168.0.140'
  var packet = {
    cmd: 'connect',
    protocolId: 'MQIsdp',
    protocolVersion: 3,
    clean: true,
    clientId: 'my-client-proxyV1',
    keepalive: 0
  }

  var buf = mqttPacket.generate(packet)
  var src = new proxyProtocol.Peer(clientIp, 12345)
  var dst = new proxyProtocol.Peer('127.0.0.1', port)
  var protocol = new proxyProtocol.V1BinaryProxyProtocol(
    proxyProtocol.INETProtocol.TCP4,
    src,
    dst,
    buf
  ).build()

  var broker = aedes({
    preConnect: function (client, done) {
      if (client.connDetails && client.connDetails.ipAddress) {
        client.ip = client.connDetails.ipAddress
        t.equal(clientIp, client.ip)
      } else {
        t.fail('no ip address present')
      }
      done(null, true)
    },
    trustProxy: true
  })

  var server = net.createServer(broker.handle)
  server.listen(port, function (err) {
    t.error(err, 'no error')
  })

  var client = net.connect({
    port,
    timeout: 0
  }, function () {
    client.write(protocol)
  })

  t.tearDown(() => {
    client.end()
    broker.close()
    server.close()
  })
})

test('tcp proxied (protocol v2) clients have access to the ipAddress(v4)', function (t) {
  t.plan(2)

  var port = 4883
  var clientIp = '192.168.0.140'
  var packet = {
    cmd: 'connect',
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    clientId: 'my-client-proxyV2'
  }

  var protocol = new proxyProtocol.V2ProxyProtocol(
    proxyProtocol.Command.LOCAL,
    proxyProtocol.TransportProtocol.DGRAM,
    new proxyProtocol.IPv4ProxyAddress(
      proxyProtocol.IPv4Address.createFrom(clientIp.split('.')),
      12345,
      proxyProtocol.IPv4Address.createFrom([127, 0, 0, 1]),
      port
    ),
    mqttPacket.generate(packet)
  ).build()

  var broker = aedes({
    preConnect: function (client, done) {
      if (client.connDetails && client.connDetails.ipAddress) {
        client.ip = client.connDetails.ipAddress
        t.equal(clientIp, client.ip)
      } else {
        t.fail('no ip address present')
      }
      done(null, true)
    },
    trustProxy: true
  })

  var server = net.createServer(broker.handle)
  server.listen(port, function (err) {
    t.error(err, 'no error')
  })

  var client = net.createConnection(
    {
      port,
      timeout: 0
    }, function () {
      client.write(Buffer.from(protocol))
    }
  )

  t.tearDown(() => {
    client.end()
    broker.close()
    server.close()
  })
})

test('tcp proxied (protocol v2) clients have access to the ipAddress(v6)', function (t) {
  t.plan(2)

  var port = 4883
  var clientIpArray = [0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 192, 168, 1, 128]
  var clientIp = '::ffff:c0a8:180:'
  var packet = {
    cmd: 'connect',
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    clientId: 'my-client-proxyV2'
  }

  var protocol = new proxyProtocol.V2ProxyProtocol(
    proxyProtocol.Command.PROXY,
    proxyProtocol.TransportProtocol.STREAM,
    new proxyProtocol.IPv6ProxyAddress(
      proxyProtocol.IPv6Address.createFrom(clientIpArray),
      12345,
      proxyProtocol.IPv6Address.createWithEmptyAddress(),
      port
    ),
    mqttPacket.generate(packet)
  ).build()

  var broker = aedes({
    preConnect: function (client, done) {
      if (client.connDetails && client.connDetails.ipAddress) {
        client.ip = client.connDetails.ipAddress
        t.equal(clientIp, client.ip)
      } else {
        t.fail('no ip address present')
      }
      done(null, true)
    },
    trustProxy: true
  })

  var server = net.createServer(broker.handle)
  server.listen(port, function (err) {
    t.error(err, 'no error')
  })

  var client = net.createConnection(
    {
      port,
      timeout: 0
    }, function () {
      client.write(Buffer.from(protocol))
    }
  )

  t.tearDown(() => {
    client.end()
    broker.close()
    server.close()
  })
})

test('websocket clients have access to the ipAddress from the socket (if no ip header)', function (t) {
  t.plan(2)

  var clientIp = '::ffff:127.0.0.1'
  var port = 4883
  var broker = aedes({
    preConnect: function (client, done) {
      if (client.connDetails && client.connDetails.ipAddress) {
        client.ip = client.connDetails.ipAddress
        t.equal(clientIp, client.ip)
      } else {
        t.fail('no ip address present')
      }
      done(null, true)
    },
    trustProxy: true
  })

  var server = http.createServer()
  ws.createServer({
    server: server
  }, broker.handle)

  server.listen(port, function (err) {
    t.error(err, 'no error')
  })

  var client = mqtt.connect(`ws://localhost:${port}`)

  t.tearDown(() => {
    client.end(true)
    broker.close()
    server.close()
  })
})

test('websocket proxied clients have access to the ipAddress from x-real-ip header', function (t) {
  t.plan(2)

  var clientIp = '192.168.0.140'
  var port = 4883
  var broker = aedes({
    preConnect: function (client, done) {
      if (client.connDetails && client.connDetails.ipAddress) {
        client.ip = client.connDetails.ipAddress
        t.equal(clientIp, client.ip)
      } else {
        t.fail('no ip address present')
      }
      done(null, true)
    },
    trustProxy: true
  })

  var server = http.createServer()
  ws.createServer({
    server: server
  }, broker.handle)

  server.listen(port, function (err) {
    t.error(err, 'no error')
  })

  var client = mqtt.connect(`ws://localhost:${port}`, {
    wsOptions: {
      headers: {
        'X-Real-Ip': clientIp
      }
    }
  })

  t.tearDown(() => {
    client.end(true)
    broker.close()
    server.close()
  })
})

test('websocket proxied clients have access to the ipAddress from x-forwarded-for header', function (t) {
  t.plan(2)

  var clientIp = '192.168.0.140'
  var port = 4883
  var broker = aedes({
    preConnect: function (client, done) {
      if (client.connDetails && client.connDetails.ipAddress) {
        client.ip = client.connDetails.ipAddress
        t.equal(clientIp, client.ip)
      } else {
        t.fail('no ip address present')
      }
      done(null, true)
    },
    trustProxy: true
  })

  var server = http.createServer()
  ws.createServer({
    server: server
  }, broker.handle)

  server.listen(port, function (err) {
    t.error(err, 'no error')
  })

  var client = mqtt.connect(`ws://localhost:${port}`, {
    wsOptions: {
      headers: {
        'X-Forwarded-For': clientIp
      }
    }
  })

  t.tearDown(() => {
    client.end(true)
    broker.close()
    server.close()
  })
})

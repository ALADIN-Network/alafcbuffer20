const BN = require('bn.js')
const {Long} = require('bytebuffer')

const types = {
  bytes: () => [bytebuf],
  string: () => [string],
  vector: (type, sorted) => [vector, {type, sorted}],
  optional: type => [optional, {type}],
  time: () => [time],
  map: (annotation) => [map, {annotation}],

  fixed_string16: () => [string, {maxLen: 16}],
  fixed_string32: () => [string, {maxLen: 32}],

  fixed_bytes16: () => [bytebuf, {len: 16}],
  fixed_bytes28: () => [bytebuf, {len: 28}],
  fixed_bytes32: () => [bytebuf, {len: 32}],
  fixed_bytes33: () => [bytebuf, {len: 33}],
  fixed_bytes64: () => [bytebuf, {len: 64}],
  fixed_bytes65: () => [bytebuf, {len: 65}],

  uint8: () => [intbuf, {bits: 8}],
  uint16: () => [intbuf, {bits: 16}],
  uint32: () => [intbuf, {bits: 32}],
  uint64: () => [intbuf, {bits: 64}],
  // ,128,224,256,512 TODO

  int8: () => [intbuf, {signed: true, bits: 8}],
  int16: () => [intbuf, {signed: true, bits: 16}],
  int32: () => [intbuf, {signed: true, bits: 32}],
  int64: () => [intbuf, {signed: true, bits: 64}]
  // ,128,224,256,512 TODO

  // VarInt32: ()=> [intbuf, {signed: true, bits: 32}],
}

/*
  @arg {SerializerConfig} config
  @return {object} {[typeName]: function(args)}
*/
module.exports = config => {
  config = Object.assign({defaults: false, debug: false, customTypes: {}}, config)

  const allTypes = Object.assign({}, types, config.customTypes)

  const createTypeReducer = baseTypes => (customTypes, name) => {
    customTypes[name] = (...args) => {
      const type = createType(name, config, args, baseTypes, allTypes, customTypes)
      return type
    }
    return customTypes
  }

  const baseTypes = Object.keys(types)
    .reduce(createTypeReducer(), {})

  const customTypes = Object.keys(config.customTypes || {})
    .reduce(createTypeReducer(baseTypes), {})

  return Object.assign({}, baseTypes, customTypes, {config})
}


/**
    @args {string} typeName - matches types[]
    @args {string} config - Additional arguments for types
*/
function createType (typeName, config, args, baseTypes, allTypes, customTypes) {
  const Type = baseTypes ? allTypes[typeName] : types[typeName]
  const [fn, v = {}] = Type(...args)
  const validation = Object.assign(v, config)
  validation.typeName = typeName
  // if(typeName === 'vector') console.log('typeName', validation)
  const type = fn(validation, baseTypes, customTypes)
  return type
}

const map = validation => {
  const {annotation: [type1, type2]} = validation
  if (!isSerializer(type1)) { throw new TypeError(`map<type1, > unknown`) }
  if (!isSerializer(type2)) { throw new TypeError(`map<, type2> unknown`) }
  
  return {
    fromByteBuffer (b) {
      const size = b.readVarint32()
      const result = {}
      for (let i = 0; i < size; i++) {
        result[type1.fromByteBuffer(b)] = type2.fromByteBuffer(b)
      }
      if (validation.debug) {
        console.log('0x' + size.toString(16), '(map.fromByteBuffer length)', result)
      }
      return result
    },
    appendByteBuffer (b, value) {
      validate(value, validation)
      const keys = Object.keys(value)
      b.writeVarint32(keys.length)
      if (validation.debug) {
        console.log('0x' + keys.length.toString(16), '(map.appendByteBuffer length)', keys)
      }
      // if(sorted) {
      //   value = sortKeys(type1, Object.assign({}, value))
      // }
      for (const o of keys) {
        const value2 = value[o]
        type1.appendByteBuffer(b, o)
        type2.appendByteBuffer(b, value2)
      }
    },
    fromObject (value) {
      validate(value, validation)
      const result = {}
      // if(sorted) {
      //   value = sortKeys(type1, Object.assign({}, value))
      // }
      for (const o in value) {
        result[type1.fromObject(o)] = type2.fromObject(value[o])
      }
      return result
    },
    toObject (value) {
      if (validation.defaults && value == null) {
        return {[type1.toObject(null)]: type2.toObject(null)}
      }
      validate(value, validation)
      const result = {}
      // if(sorted) {
      //   value = sortKey(type1, Object.assign({}, value))
      // }
      for (const o in value) {
        result[type1.toObject(o)] = type2.toObject(value[o])
      }
      return result
    }
  }
}

const vector = validation => {
  const {type, sorted} = validation
  if (!isSerializer(type)) { throw new TypeError('vector type should be a serializer') }
  
  return {
    fromByteBuffer (b) {
      const size = b.readVarint32()
      if (validation.debug) {
        console.log('0x' + size.toString(16), '(vector.fromByteBuffer length)')
      }
      const result = []
      for (let i = 0; i < size; i++) {
        result.push(type.fromByteBuffer(b))
      }
      return result
    },
    appendByteBuffer (b, value) {
      validate(value, validation)
      b.writeVarint32(value.length)
      if(sorted) {
        value = sort(type, Object.assign([], value))
      }
      if (validation.debug) {
        console.log('0x' + value.length.toString(16), '(vector.appendByteBuffer length)', value)
      }
      for (const o of value) {
        type.appendByteBuffer(b, o)
      }
    },
    fromObject (value) {
      validate(value, validation)
      const result = []
      if(sorted) {
        value = sort(type, Object.assign([], value))
      }
      for (const o of value) {
        result.push(type.fromObject(o))
      }
      return result
    },
    toObject (value) {
      if (validation.defaults && value == null) {
        return [type.toObject(value)]
      }
      validate(value, validation)
      const result = []
      if(sorted) {
        value = sort(type, Object.assign([], value))
      }
      for (const o of value) {
        result.push(type.toObject(o))
      }
      return result
    }
  }
}

const optional = validation => {
  const {type} = validation
  if (!isSerializer(type)) { throw new TypeError('optional parameter should be a serializer') }

  return {
    fromByteBuffer (b) {
      if (!(b.readUint8() === 1)) {
        return null
      }
      return type.fromByteBuffer(b)
    },
    appendByteBuffer (b, value) {
      if (value != null) {
        b.writeUint8(1)
        type.appendByteBuffer(b, value)
      } else {
        b.writeUint8(0)
      }
    },
    fromObject (value) {
      if (value == null) {
        return null
      }
      return type.fromObject(value)
    },
    toObject (value) {
            // toObject is only null save if defaults is true
      let resultValue
      if (value == null && !validation.defaults) {
        resultValue = null
      } else {
        resultValue = type.toObject(value)
      }
      return resultValue
    }
  }
}

const intbufType = ({signed = false, bits}) =>
    // variable ? `${signed ? 'Varint' : 'Uint'}${bits}` : // Varint32 was used at some point
    `${signed ? 'Int' : 'Uint'}${bits}`

const intbuf = (validation) => ({
  fromByteBuffer (b) {
    const value = b[`read${intbufType(validation)}`]()
    return Long.isLong(value) ? value.toString() : value
  },
  appendByteBuffer (b, value) {
    // validateInt(value, validation)
    // value = typeof value === 'string' ? Long.fromString(value) : value
    b[`write${intbufType(validation)}`](value)
  },
  fromObject (value) {
    validateInt(value, validation)
    // if(validation.bits > 53 && typeof value === 'number')
    //     value = String(value)

    return value
  },
  toObject (value) {
    if (validation.defaults && value == null) {
      return validation.bits > 53 ? '0' : 0
    }

    validateInt(value, validation)
    // if(validation.bits > 53 && typeof value === 'number')
    //     value = String(value)

    return Long.isLong(value) ? value.toString() : value
  }
})

const bytebuf = (validation) => {
  const _bytebuf = {
    fromByteBuffer (b) {
      const {len} = validation
      let bCopy
      if (len == null) {
        const lenPrefix = b.readVarint32()
        bCopy = b.copy(b.offset, b.offset + lenPrefix)
        b.skip(lenPrefix)
      } else {
        bCopy = b.copy(b.offset, b.offset + len)
        b.skip(len)
      }
      return Buffer.from(bCopy.toBinary(), 'binary')
    },
    appendByteBuffer (b, value) {
      // value = _bytebuf.fromObject(value)

      const {len} = validation
      if (len == null) {
        b.writeVarint32(value.length)
      }
      b.append(value.toString('binary'), 'binary')
    },
    fromObject (value) {
      if (typeof value === 'string') { value = Buffer.from(value, 'hex') }

      validate(value, validation)
      return value
    },
    toObject (value) {
      const {defaults, len} = validation
      if (defaults && value == null) {
        return Array(len ? len + 1 : 1).join('00')
      }
      validate(value, validation)
      return value.toString('hex')
    }
  }
  return _bytebuf
}

const string = (validation) => ({
  fromByteBuffer (b) {
    return b.readVString()
  },
  appendByteBuffer (b, value) {
    validate(value, validation)
    b.writeVString(value.toString())
  },
  fromObject (value) {
    validate(value, validation)
    return value
  },
  toObject (value) {
    if (validation.defaults && value == null) {
      return ''
    }
    validate(value, validation)
    return value
  }
})

const time = (validation) => {
  const _time = {
    fromByteBuffer (b) {
      return b.readUint32()
    },
    appendByteBuffer (b, value) {
      // if(typeof value !== "number")
      //     value = _time.fromObject(value)

      validate(value, validation)
      b.writeUint32(value)
    },
    fromObject (value) {
      validate(value, validation)

      if (typeof value === 'number') { return value }

      if (value.getTime) { return Math.floor(value.getTime() / 1000) }

      if (typeof value !== 'string') { throw new Error('Unknown date type: ' + value) }

      // Chrome assumes Zulu when missing, Firefox does not
      if (typeof value === 'string' && !/Z$/.test(value)) { value += 'Z' }

      return Math.floor(new Date(value).getTime() / 1000)
    },
    toObject (value) {
      if (validation.defaults && value == null) { return (new Date(0)).toISOString().split('.')[0] }

      validate(value, validation)

      // if(typeof value === "string") {
      //     if(!/Z$/.test(value))
      //         value += "Z"
      //
      //     return value
      // }

      // if(value.getTime)
      //     return value.toISOString().split('.')[0] + 'Z'

      validateInt(value, spread(validation, {bits: 32}))
      const int = parseInt(value)
      return (new Date(int * 1000)).toISOString().split('.')[0]
    }
  }
  return _time
}

const validate = (value, validation) => {
  if (isEmpty(value)) {
    throw new Error(`Required ${validation.typeName}`)
  }

  if (validation.len != null) {
    if (value.length == null) { throw new Error(`len validation requries a "length" property`) }

    const {len} = validation
    if (value.length !== len) { throw new Error(`${validation.typeName} length ${value.length} does not equal ${len}`) }
  }

  if (validation.maxLen != null) {
    const {maxLen} = validation
    if (value.length == null) { throw new Error(`maxLen validation requries a "length" property`) }

    if (value.length > maxLen) { throw new Error(`${validation.typeName} length ${value.length} exceeds maxLen ${maxLen}`) }
  }
}

const ZERO = new BN()
const ONE = new BN('1')

function validateInt (value, validation) {
  if (isEmpty(value)) {
    throw new Error(`Required ${validation.typeName}`)
  }
  const {signed = false, bits = 54} = validation

  value = String(value).trim()
  if(
    (signed && !/^-?[0-9]+$/.test(value)) ||
    (!signed && !/^[0-9]+$/.test(value))
  ) {
    throw new Error(`Number format ${validation.typeName} ${value}`)
  }

  const max = signed ? maxSigned(bits) : maxUnsigned(bits)
  const min = signed ? minSigned(bits) : ZERO
  const i = new BN(value)

  // console.log('i.toString(), min.toString()', i.toString(), min.toString())
  if (i.cmp(min) < 0 || i.cmp(max) > 0) {
    throw new Error(`Overflow ${validation.typeName} ${value}, ` +
            `max ${max.toString()}, min ${min.toString()}, signed ${signed}, bits ${bits}`)
  }
}

/**
  Sort by the first element in a definition. Deterministic ordering is very important.
*/
const compare = values => {
  const firstKey = Object.keys(values)[0]
  const firstType = values[firstKey]
  return (a, b) => {
    const valA = a[firstKey]
    const valB = b[firstKey]

    if (firstType.compare) {
      return firstType.compare(valA, valB)
    }

    if (typeof valA === 'number' && typeof valB === 'number') {
      return valA - valB
    }

    let encoding
    if (Buffer.isBuffer(valA) && Buffer.isBuffer(valB)) {
      // A binary string compare does not work.  If localeCompare is well
      // supported that could replace HEX.  Performanance is very good so
      // comparing HEX is used for now.
      encoding = 'hex'
    }
    const strA = toString(valA, encoding)
    const strB = toString(valB, encoding)
    return strA > strB ? 1 : strA < strB ? -1 : 0
  }
}

const isSerializer = type =>
  typeof type === 'object' &&
  typeof type.fromByteBuffer === 'function' &&
  typeof type.appendByteBuffer === 'function' &&
  typeof type.fromObject === 'function' &&
  typeof type.toObject === 'function'

const toString = (value, encoding) =>
  value == null ? value :
  value.toString ? value.toString(encoding) :
  value

const sort = (type, values) =>
  type.compare ? values.sort(type.compare(values)) :
  values.sort(compare(values))

const spread = (...args) => Object.assign(...args)
const isEmpty = value => value == null

// 1 << N === Math.pow(2, N)
const maxUnsigned = bits => new BN(1).ishln(bits).isub(ONE)
const maxSigned = bits => new BN(1).ishln(bits - 1).isub(ONE)
const minSigned = bits => new BN(1).ishln(bits - 1).ineg()

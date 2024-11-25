'use strict'

function AprilTags() {
  let tags = []

  const detect = Module.cwrap('detect', 'number', [
    'number', 'number', 'number', 'number'
  ])

  const detected = Runtime.addFunction(function(
    id,
    x1,y1,x2,y2,x3,y3,x4,y4,
    m00,m01,m02,m10,m11,m12,m20,m21,m22
  ) {
    tags.push({
      id: id,
      x1: x1, y1: y1,
      x2: x2, y2: y2,
      x3: x3, y3: y3,
      x4: x4, y4: y4,
      m: [m00,m01,m02,m10,m11,m12,m20,m21,m22],
    })
  })

  const detect_in_canvas_ctx = function(ctx) {
    const w = ctx.canvas.width, h = ctx.canvas.height
    const imageData = ctx.getImageData(0, 0, w, h)

    const buf = Module._malloc(imageData.data.length * imageData.data.BYTES_PER_ELEMENT)
    Module.HEAPU8.set(imageData.data, buf)

    console.log("Detecting...")
    tags = []
    detect(detected, w, h, buf)
    Module._free(buf)

    console.log("Detected", tags)
    return {
      tags: tags,
      width: w,
      height: h,
    }
  }

  const detect_in_image = function(im) {
    const src_w = im.width
    const src_h = im.height

    const mapping_resolution = 1000

    let downscale = 1
    if (src_w > mapping_resolution)
        downscale = src_w / mapping_resolution
    if (src_h > mapping_resolution)
        downscale = Math.max(src_h / mapping_resolution, downscale)

    const w = Math.floor(src_w / downscale)
    const h = Math.floor(src_h / downscale)

    console.log("Creating canvas", w, h)
    const canvas = document.createElement('canvas')
    canvas.width  = w
    canvas.height = h

    const ctx = canvas.getContext("2d")
    ctx.drawImage(im, 0,0, w, h)
    console.log("Fetching scaled image")
    return detect_in_canvas_ctx(ctx)
  }

  return {
    detect_in_canvas_ctx,
    detect_in_image,
  }
}

const detector = AprilTags()

const EventBus = new Vue()

const store = new Vuex.Store({
  strict: true,
  state: {
    // synced to config
    screens: [],
    snapshot_w: 0,
    snapshot_h: 0,

    // internal state
    save_seq: 0,
    assigned_serials: null,
    message: '',
  },
  getters: {
    num_mappings(state, getters) {
      let num = 0
      for (const screen of getters.assigned_screens) {
        num += screen.num_configured
      } 
      return num
    },
    has_any_mapping(state, getters) {
      return getters.num_mappings > 0
    },
    assigned_screens(state) {
      let screens = []
      for (const screen_id in state.screens) {
        const screen = state.screens[screen_id]
        if (state.assigned_serials.has(screen.serial)) {
          screens.push({
            screen_id: parseInt(screen_id),
            serial: screen.serial,
            num_configured: (
                (screen.homography.length > 0 ? 1 : 0) +
                (screen.homography_secondary.length > 0 ? 1 : 0)
            )
          })
        }
      }
      screens.sort((a, b) => {
        return a.serial.localeCompare(b.serial)
      })
      return screens
    },
    has_screens(state) {
      return state.assigned_serials.size > 0
    },
  },
  mutations: {
    init_screens(state, {screens, assigned_serials}) {
      for (const idx in screens) {
        const screen = screens[idx]
        // compatibility for upgrading from previous package version
        if (!screen.homography_secondary) {
          screen.homography_secondary = []
        }
      }
      state.screens = screens
      state.assigned_serials = assigned_serials
    },
    set_snapshot(state, {snapshot_w, snapshot_h}) {
      state.snapshot_w = snapshot_w
      state.snapshot_h = snapshot_h
    },
    trim_screens(state) {
      for (let screen_id = state.screens.length-1; screen_id >= 0; screen_id--) {
        const screen = state.screens[screen_id]
        if (!state.assigned_serials.has(screen.serial)) {
          state.screens.splice(-1, 1)
        } else {
          break
        }
      }
    },
    add_screen(state, serial) {
      state.screens.push({
        serial: serial,
        homography: [],
        homography_secondary: [],
      })
      console.log("screen added:", serial)
      this.commit('needs_save')
    },
    reset_screen(state, screen_id) {
      const screen = state.screens[screen_id]
      screen.homography = []
      screen.homography_secondary = []
    },
    reset_mapping(state) {
      // reset the complete mapping
      state.screens = []
      for (const serial of state.assigned_serials) {
        this.commit('add_screen', serial)
      }
    },
    update_mapping(state, {screen_id, is_secondary, homography}) {
      if (screen_id >= 0 && screen_id < state.screens.length) {
        if (!is_secondary) {
          state.screens[screen_id].homography = homography
        } else {
          state.screens[screen_id].homography_secondary = homography
        }
      }
      this.commit('needs_save')
    },
    set_message(state, message) {
      state.message = message
    },
    needs_save(state) {
      console.log("needs save")
      state.save_seq += 1
    },
  },
  actions: {
    init_from_config({state, commit, getters}, {config, devices}) {
      let assigned_serials = new Set()
      for (const device of devices) {
        if (device.assigned) {
          assigned_serials.add(device.serial)
        }
      }
      commit('init_screens', {
        screens: config.screens,
        assigned_serials: assigned_serials,
      })
      commit('set_snapshot', {
        snapshot_w: config.snapshot_w,
        snapshot_h: config.snapshot_h,
      })

      // test which screens got removed
      let configured_serials = new Set()
      const screens = state.screens
      for (const screen_id in screens) {
        const screen = screens[screen_id]
        configured_serials.add(screen.serial)
        if (!state.assigned_serials.has(screen.serial)) {
          commit("reset_screen", screen_id)
        }
      }

      // test which screens got added
      let has_new_screens = false
      for (const serial of state.assigned_serials) {
        if (!configured_serials.has(serial)) {
          has_new_screens = true
          commit("add_screen", serial)
        }
      }

      commit("trim_screens")

      if (has_new_screens) {
        commit('set_message', 'New devices have been added. Save the setup to start mapping them.')
      } else {
        if (getters.assigned_screens.length == 0) {
          commit('set_message', 'No screens yet. Assign one or more devices to this setup, then return to this configuration page.')
        } else if (!getters.has_any_mapping) {
          commit('set_message', 'No mapping yet. Upload a mapping picture or start Webcam Mapping to configure your video wall.')
        } else {
          commit('set_message', 'Take additional mapping picture or start Webcam Mapping to continue mapping.')
        }
      }
    },
    add_mapping({commit, state, getters}, {width, height, tags}) {
      const resolution_changed = state.snapshot_w != width || state.snapshot_h != height

      if (resolution_changed) {
        commit('set_snapshot', {
          snapshot_w: width,
          snapshot_h: height,
        })
        commit('reset_mapping')
        commit('set_message', 'Mapping picture resolution has been updated. Save the setup to apply the result.')
      }

      // Apply detected tags
      for (const idx in tags) {
        const tag = tags[idx]
        commit('update_mapping', {
          screen_id: (tag.id % 128) - 1,
          is_secondary: tag.id > 128,
          homography: tag.m,
        })
      }
    },
  }
})

Vue.component('config-ui', {
  template: `
    <div>
      <h2>{{screens.length == 0 ? "No" : screens.length}} Video Wall Device{{screens.length != 1 ? "s" : ""}}</h2>
      <table class='table table-condensed' v-if='screens.length > 0'>
        <tbody>
          <tr
            v-for="screen in screens"
            :class="{
              'alert-success': screen.num_configured > 0,
              'alert-danger': screen.num_configured == 0,
          }">
            <td>
              Device {{screen.serial}}&nbsp;-&nbsp;
              <b v-if='screen.num_configured == 2'>
                Both displays mapped.
              </b>
              <b v-else-if='screen.num_configured == 1'>
                One display mapped.
              </b>
              <b v-else>
                Not mapped yet.
              </b>
            </td>
          </tr>
        </tbody>
      </table>

      <div class='alert alert-warning' v-else>
        No devices assigned to this setup yet. Click on the
        'Assigned Device' tab above and add devices to this
        setup. Then return to this configuration page.
      </div>

      <div class='panel panel-default mapping-tool'>
        <div class='panel-heading'>
          Magic Mapping Tool
        </div>
        <div class='panel-body'>
          <div class="btn-group btn-group-justified">
            <div class="btn-group">
              <label class="btn btn-primary" :disabled='is_mapping'>
                <span class='glyphicon glyphicon-upload'></span>
                Upload/Capture Mapping Picture
                <input type="file" accept="image/*" @change="onUpload" hidden>
              </label>
            </div>
            <div class="btn-group">
              <template v-if='is_mapping'>
                <button class="btn btn-block btn-primary" @click="stopCamMapping">
                  Stop Webcam Mapping
                </button>
              </template>
              <template v-else>
                <button
                  class="btn btn-primary"
                  :disabled='!can_capture || opening_cam'
                  @click="onCamMapping"
                >
                  <span class='glyphicon glyphicon-camera'></span>
                  <template v-if='opening_cam'>
                    Opening camera...
                  </template>
                  <template v-else>
                    Start Webcam Mapping
                  </template>
                </button>
              </template>
            </div>
            <div class="btn-group">
              <button
                class='btn btn-primary'
                :disabled='!has_any_mapping'
                @click="onResetMapping"
              >
                <span class='glyphicon glyphicon-repeat'></span>
                Reset mapping
              </button>
            </div>
          </div>
          <div class='video' v-if='is_mapping'>
            <video ref='video' autoplay/>
            <canvas ref='preview'/>
          </div>
          <div class='alert alert-info'>
            <b>Next step</b>: {{message}}
          </div>
        </div>
      </div>
      <div class='popup'/>
    </div>
  `,
  data: () => ({
    can_capture: !!navigator.mediaDevices,
    is_mapping: false,
    opening_cam: false,
    preview_timeout: null,
  }),
  created() {
    EventBus.$on('saved', this.onSave)
  },
  computed: {
    message() {
      return this.$store.state.message
    },
    num_mappings() {
      return this.$store.getters.num_mappings
    },
    has_any_mapping() {
      return this.$store.getters.has_any_mapping
    },
    screens() {
      return this.$store.getters.assigned_screens
    }
  },
  methods: {
    onResetMapping() {
      this.allow_updates = false
      this.$store.commit('reset_mapping')
      this.setMessage('Mapping has been reset. Save this setup to show mapping tags on all displays.')
    },
    async mapFromUrl(img_url) {
      this.setMessage('Analysing mapping picture. Please wait..')
      await this.$nextTick()
      const im = new Image()
      im.onload = async () => {
        console.log("Got image")
        const detection = detector.detect_in_image(im)
        const tags = detection.tags
        console.log(tags.length, 'tags detected')
        const before = this.num_mappings
        this.$store.dispatch('add_mapping', {
          width: detection.width,
          height: detection.height,
          tags: tags,
        })
        if (this.num_mappings != before) {
          this.setMessage('Mapping updated. Save this setup to apply the changes to your displays.')
        } else {
          this.setMessage('No new displays detected. Upload another mapping picture to try again.')
        }
      }
      im.src = img_url
    },
    stopCamMapping() {
      if (this.preview_timeout) {
        clearTimeout(this.preview_timeout)
        this.preview_timeout = null
      }
      const video = this.$refs.video
      const tracks = video.srcObject.getTracks()
      for (const idx in tracks) {
        tracks[idx].stop()
      }
      video.srcObject = null
      this.is_mapping = false
      this.setMessage('Webcam Mapping stopped. Save to apply any changes or continue mapping.')
    },
    updateDetection() {
      const video = this.$refs.video
      const width = video.offsetWidth
      const height = video.offsetHeight

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0, width, height)

      const preview = this.$refs.preview
      preview.style.left = video.offsetLeft + 'px'
      preview.width = width
      preview.height = height
      const preview_ctx = preview.getContext('2d')
      preview_ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (this.allow_updates) {
        const detection = detector.detect_in_canvas_ctx(ctx)
        const tags = detection.tags
        for (const idx in tags) {
          const tag = tags[idx]
          const cx = (tag.x1+tag.x2+tag.x3+tag.x4)/4,
                cy = (tag.y1+tag.y2+tag.y3+tag.y4)/4
          const screens = this.$store.state.screens
          const screen = screens[(tag.id % 128) - 1]
          const display = (tag.id > 128) * 1
          preview_ctx.lineWidth = 2
          if (screen) {
            preview_ctx.fillStyle = 'rgba(0,255,0,0.9)'
          } else {
            preview_ctx.fillStyle = 'rgba(128,128,128,0.9)'
          }
          preview_ctx.beginPath()
          preview_ctx.moveTo(tag.x1, tag.y1)
          preview_ctx.lineTo(tag.x2, tag.y2)
          preview_ctx.lineTo(tag.x3, tag.y3)
          preview_ctx.lineTo(tag.x4, tag.y4)
          preview_ctx.closePath()
          preview_ctx.fill()
          preview_ctx.fillStyle = 'black'
          preview_ctx.font = "10px Arial"
          if (screen) {
            preview_ctx.fillText(`${screen.serial}`, cx-30, cy-2)
          } else {
            preview_ctx.fillText(`<Unknown>`, cx-30, cy-2)
          }
          preview_ctx.fillText(`HDMI${display}`, cx-15, cy+8)
        }

        const before = this.num_mappings
        this.$store.dispatch('add_mapping', {
          width: detection.width,
          height: detection.height,
          tags: detection.tags,
        })
        if (this.num_mappings != before) {
          this.setMessage('Mapping updated. Save this setup to apply the changes to your displays.')
        }
      } else {
        preview_ctx.fillStyle = 'white'
        preview_ctx.font = "15px Arial"
        preview_ctx.fillText(`Detection paused. Save this setup to resume.`, 5, 20)
      }
      this.preview_timeout = setTimeout(this.updateDetection, 1000)
    },
    async onCamMapping() {
      this.opening_cam = true
      await this.$nextTick()
      try {
        let stream = await navigator.mediaDevices.getUserMedia({video: true})
        this.is_mapping = true
        await this.$nextTick()
        const video = this.$refs.video
        video.srcObject = stream
        this.allow_updates = true
        this.setMessage('Webcam Mapping started. Point the camera to your displays.')
        this.preview_timeout = setTimeout(this.updateDetection, 100)
      } catch (err) {
        console.log(err)
        alert("Cannot access the camera")
      }
      this.opening_cam = false
    },
    onUpload(evt) {
      const reader = new FileReader()
      reader.onload = evt => {
        this.mapFromUrl(evt.target.result)
      }
      reader.readAsDataURL(evt.target.files[0])
    },
    onSave() {
      this.allow_updates = true
      if (this.preview_timeout) {
        clearTimeout(this.preview_timeout)
        if (this.is_mapping) {
          this.preview_timeout = setTimeout(this.updateDetection, 3000)
        }
      }
      if (!this.has_any_mapping) {
        this.setMessage('Devices are updating now and will show mapping tags. Upload a mapping picture or start Webcam Mapping to configure your video wall.')
      } else {
        this.setMessage(`Devices are updating now. If there's still unmapped screens, continue mapping.`)
      }
    },
    setMessage(msg) {
      this.$store.commit('set_message', msg)
    },
  }
})

ib.setDefaultStyle()
ib.ready.then(() => {
  let last_save = 0
  store.subscribe((mutation, state) => {
    if (state.save_seq != last_save) {
      ib.setConfig({
        screens: state.screens,
        snapshot_w: state.snapshot_w,
        snapshot_h: state.snapshot_h,
      })
      last_save = state.save_seq
    }
  })

  store.dispatch('init_from_config', {
    config: ib.config,
    devices: ib.devices,
  })

  ib.onConfigSave && ib.onConfigSave(() => {
    EventBus.$emit('saved')
  })
  new Vue({
    el: "#app",
    store,
  })
})

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

const editor = {
  state: {
    message: '',
  },
  mutations: {
    set_message(state, message) {
      state.message = message
    },
  },
}

const setup_configuration = {
  namespaced: true,
  state: {
    screens: [],
    snapshot_w: 0,
    snapshot_h: 0,
  },
  getters: {
    has_any_mapping(state, getters) {
      return getters.num_mapped > 0
    },
    num_mapped(state) {
      let count = 0
      for (const idx in state.screens) {
        const screen = state.screens[idx]
        if (screen.homography.length > 0)
          count++
        if (screen.homography_secondary.length > 0)
          count++
      }
      return count
    },
    has_screens(state) {
      return state.screens.length > 0
    },
  },
  mutations: {
    set_screens(state, screens) {
      // compatibility for upgrading from previous version
      for (const idx in screens) {
        const screen = screens[idx]
        if (!screen.homography_secondary) {
          screen.homography_secondary = []
        }
      }
      state.screens = screens
    },
    set_snapshot(state, {snapshot_w, snapshot_h}) {
      state.snapshot_w = snapshot_w
      state.snapshot_h = snapshot_h
    },
    reset_mapping(state) {
      for (const idx in state.screens) {
        const screen = state.screens[idx]
        screen.homography = []
        screen.homography_secondary = []
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
    },
  },
  actions: {
    init_from_config({commit}, {config}) {
      commit('set_screens', config.screens)
      commit('set_snapshot', {
        snapshot_w: config.snapshot_w,
        snapshot_h: config.snapshot_h,
      })
    },
    start({state, commit, getters}, {devices}) {
      let assigned_unconfigured_screens = []
      for (const device of devices) {
        if (device.assigned) {
          assigned_unconfigured_screens.push({
            serial: device.serial,
            homography: [],
            homography_secondary: [],
          })
        }
      }
      assigned_unconfigured_screens.sort((a, b) => {
        return a.serial.localeCompare(b.serial)
      })
      console.log("sorted assigned screens", assigned_unconfigured_screens)

      let changed_assignment = false
      if (assigned_unconfigured_screens.length != state.screens.length) {
        console.log("assigned screens count doesn't match configured screen count")
        changed_assignment = true
      } else {
        for (const idx in assigned_unconfigured_screens) {
          const unconfigured_screen = assigned_unconfigured_screens[idx]
          const configured_screen = state.screens[idx]
          if (unconfigured_screen.serial != configured_screen.serial) {
            changed_assignment = true
            console.log("ordered serial numbers of assigned and configured screens doesn't match")
            break
          }
        }
      }

      if (changed_assignment) {
        commit('set_screens', assigned_unconfigured_screens)
        commit('reset_mapping')
        commit('set_message', 'Devices assignment has been changed. Click on "Save" to start mapping.', {root: true})
      } else {
        if (!getters.has_screens) {
          commit('set_message', 'No screens yet. Assign device to this setup, then return to this configuration page.', {root: true})
        } else if (!getters.has_any_mapping) {
          commit('set_message', 'No mapping yet. Take a mapping picture to get started.', {root: true})
        } else {
          commit('set_message', 'Take additional mapping picture to continue mapping.', {root: true})
        }
      }
    },
    add_mapping({commit, state, getters}, {width, height, tags}) {
      const resolution_changed = state.snapshot_w != width || state.snapshot_h != height

      if (resolution_changed) {
        commit('reset_mapping')
        commit('set_snapshot', {
          snapshot_w: width,
          snapshot_h: height,
        })
      }

      const before = getters.num_mapped

      // Apply detected tags
      for (const idx in tags) {
        const tag = tags[idx]
        commit('update_mapping', {
          screen_id: (tag.id % 128) - 1,
          is_secondary: tag.id > 128,
          homography: tag.m,
        })
      }

      const added = getters.num_mapped - before

      if (resolution_changed && tags.length == 0) {
        commit('set_message', 'Mapping picture resolution has been updated and the mapping as been reset. No tags detected in the new picture. Take additional mapping pictures and try again.', {root: true})
      } else if (resolution_changed && added > 0) {
        commit('set_message', `Mapping picture resolution has been updated. Mapping starts with ${added} detected tags. Click "Save" to see the current mapping or take additional mapping pictures.`, {root: true})
      } else if (tags.length == 0) {
        commit('set_message', 'No tags detected. Take additional mapping pictures and try again.', {root: true})
      } else if (added == 0) {
        commit('set_message', `No new tags found among the ${tags.length} tags detected. Take additional mapping pictures or click on "Save" to apply the current mapping.`, {root: true})
      } else {
        commit('set_message', `Found ${added} new tags. Take additional mapping pictures or click on "Save" to apply the current mapping.`, {root: true})
      }
    },
    reset_mapping({commit}) {
      commit('reset_mapping')
      commit('set_message', 'Mapping reset. Click on "Save" to show mapping tags on all displays.', {root: true})
    },
    saved({commit, getters}) {
      if (!getters.has_any_mapping) {
        commit('set_message', 'Devices are updating now and will show mapping tags. Take mapping pictures to create your video wall.', {root: true})
      } else {
        commit('set_message', 'Devices are updating now. Take additional mapping pictures to continue mapping.', {root: true})
      }
    },
  }
}

const store = new Vuex.Store({
  strict: true,
  modules: {
    config: setup_configuration,
    editor: editor,
  },
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
              <b v-if='screen.num_configured > 0'>
                {{screen.num_configured}} displays successfully mapped
              </b>
              <b v-else>
                Not mapped yet. Create a mapping picture.
              </b>
            </td>
          </tr>
        </tbody>
      </table>

      <div class='alert alert-warning' v-else>
        No devices assigned to this setup yet. Click on the 'Assigned Device'
        tab above and add devices to this setup. Then return to this
        configuration page.
      </div>

      <div class='panel panel-default mapping-tool'>
        <div class='panel-heading'>
          Magic Mapping Tool
        </div>
        <div class='panel-body'>
          <div class='alert alert-info'>
            <b>Next step</b>: {{message}}
          </div>
          <template v-if='is_mapping'>
            <div class='video'>
              <video ref='video' autoplay @click="onVideoClick"></video>
              <canvas ref='preview'></canvas>
            </div>
            <div class="btn-group btn-group-justified">
              <div class="btn-group">
                <button class="btn btn-primary" @click="useMapping"
                  :disabled='last_detection == null'
                >
                  <span class='glyphicon glyphicon-ok'></span>
                  Use current mapping
                </button>
              </div>
              <div class="btn-group">
                <button class="btn btn-default" @click="discardMapping">
                  <span class='glyphicon glyphicon-remove'></span>
                  Cancel
                </button>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="btn-group btn-group-justified">
              <div class="btn-group">
                <label class="btn btn-primary">
                  <span class='glyphicon glyphicon-upload'></span>
                  Upload/Capture Mapping Picture
                  <input type="file" accept="image/*" @change="onUpload" hidden>
                </label>
              </div>
              <div class="btn-group">
                <button
                  class="btn btn-primary"
                  :disabled='!can_capture'
                  @click="onCamMapping"
                >
                  <span class='glyphicon glyphicon-camera'></span>
                  Start Webcam Mapping
                </button>
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
          </template>
        </div>
      </div>
      <div class='popup'/>
    </div>
  `,
  data: () => ({
    can_capture: !!navigator.mediaDevices,
    is_mapping: false,
    preview_timeout: null,
    last_detection: null,
  }),
  computed: {
    message() {
      return this.$store.state.editor.message
    },
    has_any_mapping() {
      return this.$store.getters['config/has_any_mapping']
    },
    screens() {
      const config = this.$store.state.config
      let configured = []
      for (const idx in config.screens) {
        const screen = config.screens[idx]
        configured.push({
          idx: parseInt(idx),
          serial: screen.serial,
          num_configured: (
              (screen.homography.length > 0 ? 1 : 0) +
              (screen.homography_secondary.length > 0 ? 1 : 0)
          )
        })
      }
      return configured
    },
  },
  methods: {
    onResetMapping() {
      this.$store.dispatch('config/reset_mapping')
    },
    async mapFromUrl(img_url) {
      this.$store.commit('set_message', 'Analysing mapping picture. Please wait..')
      await this.$nextTick()
      const im = new Image()
      im.onload = async () => {
        console.log("Got image")
        const detection = detector.detect_in_image(im)
        const tags = detection.tags
        console.log(tags.length, 'tags detected')
        this.$store.dispatch('config/add_mapping', {
          width: detection.width,
          height: detection.height,
          tags: tags,
        })
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
      this.last_detection = null
      this.is_mapping = false
    },
    useMapping() {
      const detection = this.last_detection
      this.$store.dispatch('config/add_mapping', {
        width: detection.width,
        height: detection.height,
        tags: detection.tags,
      })
      this.stopCamMapping()
    },
    discardMapping() {
      this.stopCamMapping()
    },
    renderPreview() {
      const video = this.$refs.video
      const width = video.offsetWidth
      const height = video.offsetHeight

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0, width, height)

      const detection = detector.detect_in_canvas_ctx(ctx)
      const tags = detection.tags

      const preview = this.$refs.preview
      preview.style.left = video.offsetLeft + 'px'
      preview.width = width
      preview.height = height
      const preview_ctx = preview.getContext('2d')
      preview_ctx.clearRect(0, 0, canvas.width, canvas.height)

      for (const idx in tags) {
        const tag = tags[idx]
        const cx = (tag.x1+tag.x2+tag.x3+tag.x4)/4,
              cy = (tag.y1+tag.y2+tag.y3+tag.y4)/4
        preview_ctx.lineWidth = 2
        preview_ctx.fillStyle = 'rgba(0,255,0,0.9)'
        preview_ctx.beginPath()
        preview_ctx.moveTo(tag.x1, tag.y1)
        preview_ctx.lineTo(tag.x2, tag.y2)
        preview_ctx.lineTo(tag.x3, tag.y3)
        preview_ctx.lineTo(tag.x4, tag.y4)
        preview_ctx.closePath()
        preview_ctx.fill()
        preview_ctx.fillStyle = 'black'
        preview_ctx.font = "10px Arial"
        const screens = this.$store.state.config.screens
        const screen = screens[(tag.id % 128) - 1]
        const display = (tag.id > 128) * 1
        if (screen) {
          preview_ctx.fillText(`${screen.serial} / HDMI${display}`, cx-30, cy-2)
        } else {
          preview_ctx.fillText(`<Unknown> / HDMI${display}`, cx-30, cy-2)
        }
      }
      this.last_detection = detection
      this.preview_timeout = setTimeout(this.renderPreview, 1000)
    },
    onCamMapping(evt) {
      evt.target.blur()
      if (this.is_mapping) {
        this.captureAndCloseVideo()
      } else {
        navigator.mediaDevices.getUserMedia({video: true}).then(async stream => {
          this.is_mapping = true
          await this.$nextTick()
          const video = this.$refs.video
          video.srcObject = stream
          this.$store.commit('set_message', 'Point the camera to your screens. Click the "Use current mapping" button to add the detected screens to your video wall.')
        }).catch(err => {
          console.log(err)
          alert("Cannot access the camera")
        })
        this.preview_timeout = setTimeout(this.renderPreview, 1000)
      }
    },
    onVideoClick() {
      this.captureAndCloseVideo()
    },
    onUpload(evt) {
      const reader = new FileReader()
      reader.onload = evt => {
        this.mapFromUrl(evt.target.result)
      }
      reader.readAsDataURL(evt.target.files[0])
    },
  }
})

ib.setDefaultStyle()
ib.ready.then(() => {
  store.dispatch('config/init_from_config', {
    config: ib.config
  })
  store.subscribe((mutation, state) => {
    if (mutation.type.startsWith('config/')) {
      ib.setConfig({
        screens: state.config.screens,
        snapshot_w: state.config.snapshot_w,
        snapshot_h: state.config.snapshot_h,
      })
    }
  })
  store.dispatch('config/start', {
    devices: ib.devices,
  })
  ib.onConfigSave && ib.onConfigSave(() => {
    console.log("config saved!")
    store.dispatch('config/saved')
  })
  new Vue({
    el: "#app",
    store,
  })
})

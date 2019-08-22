'use strict';

function AprilTags() {
  var tags = [];

  var detect = Module.cwrap('detect', 'number', [
    'number', 'number', 'number', 'number'
  ]);

  var detected = Runtime.addFunction(function(
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

  return function(im) {
    var src_w = im.width;
    var src_h = im.height;

    var mapping_resolution = 1000;

    var downscale = 1;
    if (src_w > mapping_resolution)
        downscale = src_w / mapping_resolution;
    if (src_h > mapping_resolution)
        downscale = Math.max(src_h / mapping_resolution, downscale)

    var w = Math.floor(src_w / downscale);
    var h = Math.floor(src_h / downscale);

    console.log("Creating canvas", w, h);
    var canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;

    var ctx = canvas.getContext("2d");
    ctx.drawImage(im,0,0, w, h);

    console.log("Fetching scaled image");
    var imageData = ctx.getImageData(0, 0, w, h);

    var buf = Module._malloc(imageData.data.length * imageData.data.BYTES_PER_ELEMENT);
    Module.HEAPU8.set(imageData.data, buf);

    console.log("Detecting...");
    tags = [];
    detect(detected, w, h, buf);
    Module._free(buf);

    console.log("Detected", tags);
    return {
      tags: tags,
      width: w,
      height: h,
    }
  }
}

const detector = AprilTags();

const store = new Vuex.Store({
  strict: true,
  state: {
    screens: [],
    snapshot_w: 0,
    snapshot_h: 0,
    is_mapping: false,
    message: "",
    can_capture: !!navigator.mediaDevices,
    is_capturing: false, 
  },

  mutations: {
    init(state, {devices, config}) {
      var assigned_unconfigured_screens = [];
      for (var device of devices) {
        if (device.assigned) {
          assigned_unconfigured_screens.push({
            serial: device.serial,
            homography: [],
          });
        }
      }
      assigned_unconfigured_screens.sort(function(a, b) {
        return a.serial.localeCompare(b.serial);
      });
      console.log("sorted assigned screens", assigned_unconfigured_screens);

      var changed_assignment = false;
      if (assigned_unconfigured_screens.length != config.screens.length) {
        console.log("assigned screens count doesn't match configured screen count");
        changed_assignment = true;
      } else {
        for (var idx in assigned_unconfigured_screens) {
          var unconfigured_screen = assigned_unconfigured_screens[idx];
          var configured_screen = config.screens[idx];
          if (unconfigured_screen.serial != configured_screen.serial) {
            changed_assignment = true;
            console.log("ordered serial numbers of assigned and configured screens doesn't match");
            break;
          }
        }
      }

      if (changed_assignment) {
        state.message = "New devices have been assigned to this setup. Click on 'Save' to show the configuration tags on all device. Then create a mapping picture.";
        state.screens = assigned_unconfigured_screens;
      } else {
        state.screens = config.screens;
        var all_mapped = true;
        for (var idx in config.screens) {
          if (config.screens[idx].homography.length == 0) {
            all_mapped = false;
            break
          }
        }
        if (all_mapped) {
          state.message = "";
        } else {
          state.message = "Some devices still require a mapping configuration. Complete your mapping by uploading mapping pictures.";
        }
      }
      state.snapshot_w = config.snapshot_w;
      state.snapshot_h = config.snapshot_h;
    },
    reset_mapping(state) {
      for (var idx in state.screens) {
        var screen = state.screens[idx];
        screen.homography = [];
      }
      state.message = "Mapping removed. Click 'Save' now to display the tags on all devices again, then capture a new mapping picture.";
    },
    start_mapping(state) {
      state.is_mapping = true;
    },
    save_mapping(state, {width, height, tags, reset_mapping}) {
      if (state.snapshot_w != width || state.snapshot_h != height) {
        console.log("different snapshot resolution. Resetting mapping");
        reset_mapping = true;
      }

      state.snapshot_w = width;
      state.snapshot_h = height;

      if (reset_mapping) {
        // Empty previous mapping state
        for (var idx = 0; idx < state.screens.length; idx++) {
          var screen = state.screens[idx];
          screen.homography = [];
        }
      }

      // Apply detected tags
      for (var idx = 0; idx < tags.length; idx++) {
        var tag = tags[idx];
        var screen_id = tag.id-1;
        var homography = tag.m;
        if (screen_id >= 0 && screen_id < state.screens.length) {
          state.screens[screen_id].homography = homography;
        }
      }

      var need_mapping = false;
      for (var idx in state.screens) {
        var screen = state.screens[idx];
        if (screen.homography.length == 0) {
          need_mapping = true;
          break
        }
      }
      if (need_mapping) {
        state.message = "Detected " + tags.length + " tags. Some tags are still missing for a complete mapping. " + 
          "Please create another picture from the exact same camera position " +
          "or reset the mapping to start new. You can preview the current mapping by clicking 'Save'.";
      }
      state.is_mapping = false;
      state.is_capturing = false;
    },
    start_capture(state) {
      state.is_capturing = true;
      state.message = "Point your webcam to your screens and click the 'Capture' button again";
    },
  },
  actions: {
    init (context, init) {
      context.commit('init', init);
    },
    reset_mapping(context) {
      context.commit('reset_mapping');
    },
    start_mapping(context) {
      context.commit('start_mapping');
    },
    save_mapping(context, mapping) {
      context.commit('save_mapping', mapping);
    },
    start_capture(context) {
      context.commit('start_capture');
    },
  }
});

Vue.component('config-ui', {
  template: '#config-ui',
  computed: {
    message() {
      var s = this.$store.state;
      return s.message;
    },
    has_any_mapping() {
      var s = this.$store.state;
      for (var idx in s.screens) {
        var screen = s.screens[idx];
        if (screen.homography.length > 0) {
          return true;
        }
      }
      return false;
    },
    is_mapping() {
      var s = this.$store.state;
      return s.is_mapping;
    },
    fully_mapped() {
      var s = this.$store.state;
      for (var idx in s.screens) {
        var screen = s.screens[idx];
        if (screen.homography.length == 0) {
          return false;
        }
      }
      return true;
    },
    screens() {
      var s = this.$store.state;
      var configured = [];
      for (var idx in s.screens) {
        var screen = s.screens[idx];
        configured.push({
          idx: parseInt(idx),
          serial: screen.serial,
          configured: screen.homography.length > 0,
        })
      }
      return configured;
    },
    can_capture() {
      var s = this.$store.state;
      return s.can_capture;
    },
    is_capturing() {
      var s = this.$store.state;
      return s.is_capturing;
    }
  },
  methods: {
    onResetMapping() {
      this.$store.dispatch('reset_mapping');
    },
    onCamButton(evt) {
      if (this.is_capturing) {
        this.captureAndCloseVideo();
      } else {
        var store = this.$store;
        var video = this.$refs.video;
        navigator.mediaDevices.getUserMedia({video: true}).then(function(stream) {
          video.srcObject = stream;
          store.dispatch('start_capture');
        }).catch(function(err) {
          console.log(err);
          alert("Cannot access the camera");
        });
      }
    },
    onVideoClick(evt) {
      this.captureAndCloseVideo();
    },
    onUpload(evt) {
      var store = this.$store;
      var that = this;
      store.dispatch('start_mapping');
      var reader = new FileReader();
      reader.onload = function(evt) {
        that.mapFromUrl(evt.target.result);
      }
      reader.readAsDataURL(evt.target.files[0]);     
    },
    captureAndCloseVideo() {
      var video = this.$refs.video;
      var width = video.offsetWidth
      var height = video.offsetHeight;
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, width, height);
      video.src = "";
      this.mapFromUrl(canvas.toDataURL('image/png'));
    },
    mapFromUrl(img_url) {
      var im = new Image();
      im.onload = function() {
        console.log("Got image");
        var detection = detector(im);
        var tags = detection.tags;
        console.log(tags.length, 'tags detected');
        store.dispatch('save_mapping', {
          width: detection.width,
          height: detection.height,
          tags: tags,
          reset_mapping: false,
        });
      }
      im.src = img_url;
    },
  }
})

const app = new Vue({
  el: "#app",
  store,
})

ib.setDefaultStyle();
ib.ready.then(() => {
  store.subscribe((mutation, state) => {
    ib.setConfig({
      screens: state.screens,
      snapshot_w: state.snapshot_w,
      snapshot_h: state.snapshot_h,
    })
  })
  store.dispatch('init', {
    config: ib.config,
    devices: ib.devices,
  });
})

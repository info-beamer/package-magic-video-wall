/*
 *  info-beamer hosted.js Mockup for local development.
 *  You can find the latest version of this file at:
 * 
 *  https://github.com/info-beamer/package-sdk
 *
 *  BSD 2-Clause License
 *
 *  Copyright (c) 2017, Florian Wesch <fw@dividuum.de>
 *  All rights reserved.
 *
 *  Redistribution and use in source and binary forms, with or without
 *  modification, are permitted provided that the following conditions are met:
 *
 *  * Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 *
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 *  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 *  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 *  DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 *  FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 *  DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 *  SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 *  CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 *  OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 *  OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 */

var head = document.getElementsByTagName("head")[0];

var asset_root = "https://cdn.infobeamer.com/s/mock-use-latest/";

function setupResources(js, css) {
  for (var idx = 0; idx < js.length; idx++) {
    var script = document.createElement('script');
    script.setAttribute("type","text/javascript");
    script.setAttribute("src", asset_root + 'js/' + js[idx]);
    head.appendChild(script);
  }

  for (var idx = css.length-1; idx >= 0; idx--) {
    var link = document.createElement('link')
    link.setAttribute('rel', 'stylesheet')
    link.setAttribute('type', 'text/css')
    link.setAttribute('href', asset_root + 'css/' + css[idx])
    head.insertBefore(link, head.firstChild);
  }
}

var style = document.createElement('style');
var rules = document.createTextNode(
  "body { width: 750px; margin: auto; }"
)
style.type = 'text/css';
style.appendChild(rules);
head.appendChild(style);

if (window.MOCK_ASSETS == undefined)
  console.error("[MOCK HOSTED.JS] window.MOCK_ASSETS undefined");
if (window.MOCK_NODE_ASSETS == undefined)
  console.error("[MOCK HOSTED.JS] window.MOCK_NODE_ASSETS undefined");
if (window.MOCK_DEVICES == undefined)
  console.error("[MOCK HOSTED.JS] window.MOCK_DEVICES undefined");
if (window.MOCK_CONFIG == undefined)
  console.error("[MOCK HOSTED.JS] window.MOCK_CONFIG undefined");

var ib = {
  assets: window.MOCK_ASSETS,
  node_assets: window.MOCK_NODE_ASSETS,
  config: window.MOCK_CONFIG,
  devices: window.MOCK_DEVICES,
  doc_link_base: 'data:text/plain,This would have opened the package documentation for ',
}

ib.setDefaultStyle = function() {
  setupResources([], ['reset.css', 'bootstrap.css'])
}

ib.ready = {
  then: function(cb) {
    console.log("[MOCK HOSTED.JS] ready(...)");
    cb(ib.config)
  }
}

ib.setConfig = function(config) {
  var as_string = JSON.stringify(config);
  ib.config = JSON.parse(as_string);
  console.log("[MOCK HOSTED.JS] setConfig", as_string);
}

ib.getConfig = function(cb) {
  console.warn("[MOCK HOSTED.JS] using .getConfig is deprecated. Use .ready.then(...) instead");
  cb(ib.config);
}

ib.getDocLink = function(name) {
  return ib.doc_link_base + name;
}

window.infobeamer = ib;

gl.setup(NATIVE_WIDTH, NATIVE_HEIGHT)

util.noglobals()

-- We need to access files in playlist/
node.make_nested()

-- Start preloading images this many second before
-- they are displayed.
local PREPARE_TIME = 1 -- seconds

-- must be enough time to load a video and have it
-- ready in the paused state. Normally 500ms should
-- be enough.
local VIDEO_PRELOAD_TIME = .5 -- seconds

local font = resource.load_font "silkscreen.ttf"
local serial = sys.get_env "SERIAL"

if not pcall(require, "tagmapper") then
    function node.render()
        font:write(0,  0, "Right now this package needs the 'testing'", 30, 1,1,1,1)
        font:write(0, 30, "version of the info-beamer hosted OS. Go", 30, 1,1,1,1)
        font:write(0, 60, "to the device page, click on the 'Manage' button", 30, 1,1,1,1)
        font:write(0, 90, "in the top right corner and select 'Activate", 30,1,1,1,1)
        font:write(0,120, "testing channel' to install.", 30, 1,1,1,1)
    end
    return
end

local json = require "json"
local matrix = require "matrix2d"
local tagmapper = require "tagmapper"

local min = math.min
local assigned = false

local function msg(str, ...)
    font:write(10, HEIGHT-30, str:format(...), 24, 1,1,1,.5)
end

local tags = {}
for idx = 1, 32 do
    tags[idx] = resource.load_image{
        file = string.format("tag_%03d.png", idx),
        nearest = true,
    }
end

local function Screen()
    local mapped

    local function update(homography, snapshot_w, snapshot_h)
        if #homography == 9 then
            mapped = tagmapper.create(matrix.new(
                homography[1], homography[2], homography[3],
                homography[4], homography[5], homography[6],
                homography[7], homography[8], homography[9]
            ), snapshot_w, snapshot_h)
        else
            mapped = function() end
        end
    end

    local function draw(obj)
        return mapped(function(width, height)
            util.draw_correct(obj, 0, 0, width, height)
        end)
    end

    return {
        update = update;
        draw = draw;
    }
end

local screen = Screen()

local Image = {
    slot_time = function(self)
        return self.duration
    end;
    prepare = function(self)
        self.obj = resource.load_image(self.file:copy())
    end;
    tick = function(self, now)
        local state, w, h = self.obj:state()
        screen.draw(self.obj)
    end;
    stop = function(self)
        if self.obj then
            self.obj:dispose()
            self.obj = nil
        end
    end;
}

local Video = {
    slot_time = function(self)
        return VIDEO_PRELOAD_TIME + self.duration
    end;
    prepare = function(self)
    end;
    tick = function(self, now)
        if not self.obj then
            self.obj = resource.load_video{
                file = self.file:copy();
                paused = true;
            }
        end

        if now < self.t_start + VIDEO_PRELOAD_TIME then
            return
        end

        self.obj:start()
        local state, w, h = self.obj:state()

        if state ~= "loaded" and state ~= "finished" then
            print[[

.--------------------------------------------.
  WARNING:
  lost video frame. video is most likely out
  of sync. increase VIDEO_PRELOAD_TIME (on all
  devices)
'--------------------------------------------'
]]
        else
            screen.draw(self.obj)
        end
    end;
    stop = function(self)
        if self.obj then
            self.obj:dispose()
            self.obj = nil
        end
    end;
}

local function Playlist()
    local items = {}
    local total_duration = 0

    local function calc_start(idx, now)
        local item = items[idx]
        local epoch_offset = now % total_duration
        local epoch_start = now - epoch_offset

        item.t_start = epoch_start + item.epoch_offset
        if item.t_start - PREPARE_TIME < now then
            item.t_start = item.t_start + total_duration
        end
        item.t_prepare = item.t_start - PREPARE_TIME
        item.t_end = item.t_start + item:slot_time()
        -- pp(item)
    end

    local function tick(now)
        local num_running = 0
        local next_running = 99999999999999

        if #items == 0 then
            msg("[%s] no playlist configured", serial)
            return
        end

        for idx = 1, #items do
            local item = items[idx]
            if item.t_prepare <= now and item.state == "waiting" then
                print(now, "preparing ", item.file)
                item:prepare()
                item.state = "prepared"
            elseif item.t_start <= now and item.state == "prepared" then
                print(now, "running ", item.file)
                item.state = "running"
            elseif item.t_end <= now and item.state == "running" then
                print(now, "resetting ", item.file)
                item:stop()
                calc_start(idx, now)
                item.state = "waiting"
            end

            next_running = min(next_running, item.t_start)

            if item.state == "running" then
                item:tick(now)
                num_running = num_running + 1
            end
        end

        if num_running == 0 then
            local wait = next_running - now
            msg("[%s] waiting for sync %.1f", serial, wait)
        end
    end

    local function stop_all()
        for idx = 1, #items do
            local item = items[idx]
            item:stop()
        end
    end

    local function set(new_items)
        local now = os.time()

        total_duration = 0
        for idx = 1, #new_items do
            local item = new_items[idx]
            if item.type == "image" then
                setmetatable(item, {__index = Image})
            elseif item.type == "video" then
                setmetatable(item, {__index = Video})
            else
                return error("unsupported type" .. item.type)
            end
            item.epoch_offset = total_duration
            item.state = "waiting"
            total_duration = total_duration + item:slot_time()
        end

        stop_all()

        items = new_items
        for idx = 1, #new_items do
            calc_start(idx, now)
        end
    end

    return {
        set = set;
        tick = tick;
    }
end

local playlist = Playlist()

local function prepare_playlist(playlist)
    if #playlist >= 2 then
        return playlist
    elseif #playlist == 1 then
        -- only a single item? Copy it
        local item = playlist[1]
        playlist[#playlist+1] = {
            file = item.file,
            type = item.type,
            duration = item.duration,
        }
    end
    return playlist
end

local tag

util.file_watch("config.json", function(raw)
    local config = json.decode(raw)

    tag = nil
    assigned = false

    for idx = 1, #config.screens do
        local screen_config = config.screens[idx]
        if screen_config.serial == serial then
            screen.update(
                screen_config.homography,
                config.snapshot_w, config.snapshot_h
            )
            assigned = true
            if config.show_tags then
                tag = tags[idx]
            end
            return
        end
    end
end)

util.file_watch("playlist/config.json", function(raw)
    local config = json.decode(raw)
    local items = {}
    for idx = 1, #config.playlist do
        local item = config.playlist[idx]
        items[#items+1] = {
            file = resource.open_file('playlist/' .. item.file.asset_name),
            type = item.file.type,
            duration = item.duration,
        }
    end
    playlist.set(prepare_playlist(items))
    node.gc()
end)

function node.render()
    gl.clear(0,0,0,1)
    if not assigned then
        msg("[%s] Click on the setup, then 'Save' to start configuration", serial)
    elseif tag then
        util.draw_correct(tag, 0, 0, WIDTH, HEIGHT)
        local h = HEIGHT / 12

        local t = string.format("serial %s", serial)
        local w = font:width(t, h)
        font:write((WIDTH-w)/2, HEIGHT-h, t, h, 0,0,0,1)

        local t = "info-beamer hosted"
        local w = font:width(t, h)
        font:write((WIDTH-w)/2, h*0.05, t, h, 0,0,0,1)
    else
        playlist.tick(os.time())
    end
end

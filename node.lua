gl.setup(NATIVE_WIDTH, NATIVE_HEIGHT)

util.no_globals()

-- We need to access files in playlist/
node.make_nested()

-- Start preloading images this many second before
-- they are displayed.
local PREPARE_TIME = 1.5 -- seconds

local font = resource.load_font "silkscreen.ttf"
local tags = resource.load_image{
    file = "tags.png",
    nearest = true,
}
local black = resource.create_colored_texture(0, 0, 0, 1)

local json = require "json"
local matrix = require "matrix2d"
local tagmapper = require "tagmapper"
local scissors = sys.get_ext "scissors"

local serial = sys.get_env "SERIAL"
local assigned = false
local audio = false

local function Screen(screen_no, pos)
    local mapped = function() end
    local tag_id
    local has_mapping

    local function update(new_tag_id, homography, snapshot_w, snapshot_h)
        tag_id = new_tag_id
        if #homography == 9 then
            mapped = tagmapper.create(matrix.new(
                homography[1], homography[2], homography[3],
                homography[4], homography[5], homography[6],
                homography[7], homography[8], homography[9]
            ), snapshot_w, snapshot_h)
            has_mapping = true
        else
            mapped = function(fn) 
                fn(WIDTH, HEIGHT)
            end
            has_mapping = false
        end
    end

    local function draw(obj)
        scissors.set(pos.x1, pos.y1, pos.x2, pos.y2)
        gl.pushMatrix()
            -- right now the homography mapping function
            -- expects to map based on the full screen
            -- size. So it centered to WIDTH/2, HEIGHT/2.
            -- We modify the environment in a way so it
            -- works across multiple screens.
            gl.translate(pos.x1, pos.y1)
            WIDTH = pos.x2 - pos.x1
            HEIGHT = pos.y2 - pos.y1
            mapped(function(width, height)
                util.draw_correct(obj, 0, 0, width, height)
            end)
        gl.popMatrix()
        -- reset to previous values. this is required for
        -- scissors.disable to work properly.
        WIDTH = NATIVE_WIDTH
        HEIGHT = NATIVE_HEIGHT
        scissors.disable()
    end

    local function write(msg)
        gl.pushMatrix()
            -- gl.translate(pos.x1+10, pos.y2-10)
            -- gl.rotate(-90, 0, 0, 1)
            gl.translate(pos.x1+10, pos.y2-30)
            font:write(0, 0, msg, 24, 1,1,1,.5)
        gl.popMatrix()
    end

    local function draw_tag()
        black:draw(pos.x1, pos.y1, pos.x2, pos.y2, 0.8)
        local ox1, oy1, ox2, oy2 = util.scale_into(
            pos.x2 - pos.x1, pos.y2 - pos.y1, 10, 10
        )
        local tag_x = (tag_id-1) % 16
        local tag_y = math.floor((tag_id-1) / 16)
        local tag_w, tag_h = tags:size()
        tags:draw(
            pos.x1 + ox1,
            pos.y1 + oy1,
            pos.x1 + ox2,
            pos.y1 + oy2,
            1,
            1/tag_w * (10*tag_x   ), 1/tag_h * (10*tag_y   ), 
            1/tag_w * (10*tag_x+10), 1/tag_h * (10*tag_y+10)
        )
        local row_h = (pos.y2-pos.y1) / 12
        local screen_w = pos.x2 - pos.x1

        local t = "info-beamer hosted"
        local w = font:width(t, row_h)
        font:write(pos.x1 + (screen_w-w)/2, pos.y1+row_h*0.05, t, row_h, 0,0,0,1)

        for i, t in ipairs{
            string.format("serial %s, HDMI%d", serial, screen_no-1),
            "Take a mapping picture now",
        } do
            local w = font:width(t, row_h/2.2)
            font:write(pos.x1 + (screen_w-w)/2, pos.y2-row_h+(i-1)*row_h/2.2, t, row_h/2.2, 0,0,0,1)
        end
    end

    return {
        update = update;
        has_mapping = function()
            return has_mapping
        end;
        write = write;
        draw = draw;
        draw_tag = draw_tag;
    }
end

local function overlap(a, b)
    return a.x1 < b.x2 and a.x2 > b.x1 and
           a.y1 < b.y2 and a.y2 > b.y1
end

local screens = {}

if sys.displays then
    -- info-beamer provides display position information?
    -- check if we have an overlapping display configuration?
    -- Only use primary display in that case.
    if #sys.displays == 2 and overlap(sys.displays[1], sys.displays[2]) then
        screens[#screens+1] = Screen(1, sys.displays[1])
    else
        -- Otherwise use all the displays
        for i, display in ipairs(sys.displays) do
            screens[#screens+1] = Screen(i, display)
        end
    end
else
    -- fallback
    screens[#screens+1] = Screen(1, {
        x1 = 0,
        y1 = 0,
        x2 = WIDTH,
        y2 = HEIGHT,
    })
end

local function msg(str, ...)
    for i, screen in ipairs(screens) do
        screen.write(("[%s / %d] %s"):format(
            serial, i, str:format(...)
        ))
    end
end

local Image = {
    slot_time = function(self)
        return self.duration
    end;
    prepare = function(self)
        self.obj = resource.load_image(self.file:copy())
    end;
    tick = function(self, now)
        local state, w, h = self.obj:state()
        for i, screen in ipairs(screens) do
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

local Video = {
    slot_time = function(self)
        return self.duration
    end;
    prepare = function(self)
        self.obj = resource.load_video{
            file = self.file:copy();
            audio = audio,
            paused = true;
            looped = true;
        }
    end;
    tick = function(self, now)
        self.obj:start()
        local state, w, h = self.obj:state()

        if state ~= "loaded" and state ~= "finished" then
            print[[

.-------------------------------------------.
  WARNING:
  lost video frame. video is most likely out
  of sync. increase VIDEO_PRELOAD_TIME (on all
  devices)
'--------------------------------------------'
]]
        else
            for i, screen in ipairs(screens) do
                screen.draw(self.obj)
            end
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
            msg("no playlist configured")
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

            next_running = math.min(next_running, item.t_start)

            if item.state == "running" then
                item:tick(now)
                num_running = num_running + 1
            end
        end

        if num_running == 0 then
            local wait = next_running - now
            msg("waiting for sync %.1f", wait)
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

local function Stream()
    local vid
    local url

    local function stop()
        if vid then
            vid:dispose()
        end
        vid = nil
    end

    local function start()
        vid = resource.load_video{
            file = url,
        }
    end

    local function set(stream_url)
        if stream_url == "" then
            url = nil
            stop()
            return
        end
        if stream_url == url then
            return
        end
        stop()
        url = stream_url
        start()
    end

    local function tick()
        if not vid then
            return
        end
        local state, w, h = vid:state()
        if state == "loaded" then
            for i, screen in ipairs(screens) do
                screen.draw(vid)
            end
        elseif state == "finished" or state == "error" then
            stop()
            start()
        end
    end

    local function has_stream()
        return not not url
    end

    return {
        set = set;
        tick = tick;
        has_stream = has_stream;
    }
end

local stream = Stream()

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

util.json_watch("config.json", function(config)
    tag = nil
    assigned = false

    for idx = 1, #config.screens do
        local screen_config = config.screens[idx]
        if screen_config.serial == serial then
            for i, screen in ipairs(screens) do
                screen.update(
                    idx + (i-1)*128,
                    i == 1 and screen_config.homography or screen_config.homography_secondary,
                    config.snapshot_w, config.snapshot_h
                )
            end
            assigned = true
            return
        end
    end
end)

util.json_watch("playlist/config.json", function(config)
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
    stream.set(config.stream)
    audio = config.audio
    node.gc()
end)

local function all_mapped()
    for i, screen in ipairs(screens) do
        if not screen.has_mapping() then
            return false
        end
    end
    return true
end

function node.render()
    gl.clear(0,0,0,1)

    if not assigned then
        msg("Click on the setup, then 'Save' to start the configuration")
    elseif stream.has_stream() then
        stream.tick()
    else
        playlist.tick(os.time())
    end

    if assigned then
        for i, screen in ipairs(screens) do
            if not screen.has_mapping() then
                screen.draw_tag()
            end
        end
    end
end

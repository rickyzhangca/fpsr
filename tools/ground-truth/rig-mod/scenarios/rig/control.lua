-- fpsr-rig scenario: place blueprint(s), screenshot each, print sentinel.
-- Lab tiles: surface.generate_with_lab_tiles = true (lab-dark-1 / lab-dark-2 checkers).
-- Supports multiple jobs in one Factorio launch (see jobs.lua).

local jobs_file = require("__fpsr-rig__/scenarios/rig/jobs")

local SENTINEL_DONE = "FPSR_RIG_DONE"
local SENTINEL_SHOT = "FPSR_RIG_SHOT"
local SENTINEL_ERROR = "FPSR_RIG_ERROR"
local SETTLE_TICKS = 3
local MAX_REVIVE_PASSES = 25
local PAD_TILES = 0
local MAX_RES = 4096
local PX_PER_TILE_AT_ZOOM_1 = 32
local CHUNK_RADIUS = 12

local function log(msg)
  print("[fpsr-rig] " .. tostring(msg))
end

local function fail(msg)
  print(SENTINEL_ERROR .. ": " .. tostring(msg))
  log("FATAL: " .. tostring(msg))
  storage.done = true
end

local function expand_bbox(bb, min_x, min_y, max_x, max_y)
  if not bb then
    return min_x, min_y, max_x, max_y
  end
  local lt = bb.left_top
  local rb = bb.right_bottom
  if not lt or not rb then
    return min_x, min_y, max_x, max_y
  end
  if min_x == nil or lt.x < min_x then
    min_x = lt.x
  end
  if min_y == nil or lt.y < min_y then
    min_y = lt.y
  end
  if max_x == nil or rb.x > max_x then
    max_x = rb.x
  end
  if max_y == nil or rb.y > max_y then
    max_y = rb.y
  end
  return min_x, min_y, max_x, max_y
end

local function setup_surface(job_index)
  local name = "fpsr-rig-" .. tostring(job_index)
  local surface = game.create_surface(name)
  surface.generate_with_lab_tiles = true
  surface.always_day = true
  surface.freeze_daytime = true
  surface.daytime = 0

  surface.request_to_generate_chunks({ 0, 0 }, CHUNK_RADIUS)
  surface.force_generate_chunk_requests()
  game.forces.player.chart(surface, {
    left_top = { x = -CHUNK_RADIUS * 32, y = -CHUNK_RADIUS * 32 },
    right_bottom = { x = CHUNK_RADIUS * 32, y = CHUNK_RADIUS * 32 },
  })

  log("surface ready name=" .. name .. " (lab tiles, always_day, charted)")
  return surface
end

local function revive_all(surface)
  for pass = 1, MAX_REVIVE_PASSES do
    local entity_ghosts = surface.find_entities_filtered({ type = "entity-ghost" })
    local tile_ghosts = surface.find_entities_filtered({ type = "tile-ghost" })
    if #entity_ghosts == 0 and #tile_ghosts == 0 then
      log("revive complete after pass " .. pass)
      return
    end

    local revived = 0
    for _, ghost in pairs(entity_ghosts) do
      if ghost.valid then
        local items = ghost.revive()
        if items ~= nil then
          revived = revived + 1
        end
      end
    end
    for _, ghost in pairs(tile_ghosts) do
      if ghost.valid then
        local items = ghost.revive()
        if items ~= nil then
          revived = revived + 1
        end
      end
    end
    log(
      string.format(
        "revive pass %d: revived=%d entity_ghosts=%d tile_ghosts=%d",
        pass,
        revived,
        #entity_ghosts,
        #tile_ghosts
      )
    )
  end

  local left_e = #surface.find_entities_filtered({ type = "entity-ghost" })
  local left_t = #surface.find_entities_filtered({ type = "tile-ghost" })
  if left_e > 0 or left_t > 0 then
    log(string.format("WARNING: ghosts remain entity=%d tile=%d", left_e, left_t))
  end
end

local function place_entities_directly(surface, bp_entities, origin)
  local placed = 0
  local failed = 0
  local by_number = {}
  for _, ent in pairs(bp_entities) do
    local pos = {
      x = (ent.position.x or ent.position[1]) + origin.x,
      y = (ent.position.y or ent.position[2]) + origin.y,
    }
    local params = {
      name = ent.name,
      position = pos,
      force = game.forces.player,
      create_build_effect_smoke = false,
      raise_built = false,
    }
    if ent.direction ~= nil then
      params.direction = ent.direction
    end
    if ent.quality ~= nil then
      params.quality = ent.quality
    end
    if ent.mirror ~= nil then
      params.mirror = ent.mirror
    end

    local created = surface.create_entity(params)
    if created and created.valid then
      placed = placed + 1
      if ent.entity_number ~= nil then
        by_number[ent.entity_number] = created
      end
      if ent.recipe and created.prototype and created.prototype.type == "assembling-machine" then
        local ok_recipe = pcall(function()
          created.set_recipe(ent.recipe, ent.recipe_quality)
        end)
        if not ok_recipe then
          pcall(function()
            created.set_recipe(ent.recipe)
          end)
        end
      end
      if ent.input_priority ~= nil then
        local ok_priority, err_priority = pcall(function()
          created.splitter_input_priority = ent.input_priority
        end)
        log(
          "set splitter input priority "
            .. tostring(ent.input_priority)
            .. " ok="
            .. tostring(ok_priority)
            .. " value="
            .. tostring(created.splitter_input_priority)
            .. (ok_priority and "" or " error=" .. tostring(err_priority))
        )
      end
      if ent.output_priority ~= nil then
        local ok_priority, err_priority = pcall(function()
          created.splitter_output_priority = ent.output_priority
        end)
        log(
          "set splitter output priority "
            .. tostring(ent.output_priority)
            .. " ok="
            .. tostring(ok_priority)
            .. " value="
            .. tostring(created.splitter_output_priority)
            .. (ok_priority and "" or " error=" .. tostring(err_priority))
        )
      end
      if ent.filter ~= nil then
        local ok_filter, err_filter = pcall(function()
          created.splitter_filter = {
            name = ent.filter.name,
            quality = ent.filter.quality,
          }
        end)
        log(
          "set splitter filter "
            .. tostring(ent.filter.name)
            .. " ok="
            .. tostring(ok_filter)
            .. (ok_filter and "" or " error=" .. tostring(err_filter))
        )
      end
      if ent.filters ~= nil then
        for _, filter in pairs(ent.filters) do
          if filter.name ~= nil then
            pcall(function()
              created.set_filter(filter.index or 1, {
                name = filter.name,
                quality = filter.quality,
              })
            end)
          end
        end
        pcall(function()
          created.use_filters = true
        end)
      end
    else
      failed = failed + 1
      log("create_entity failed for " .. tostring(ent.name) .. " at " .. pos.x .. "," .. pos.y)
    end
  end
  log(string.format("direct place: placed=%d failed=%d", placed, failed))
  return by_number
end

--- Map blueprint entity_number → live entity after ghost revive (match name+position).
local function map_entities_by_number(surface, bp_entities, origin)
  local by_number = {}
  for _, ent in pairs(bp_entities) do
    if ent.entity_number ~= nil then
      local pos = {
        x = (ent.position.x or ent.position[1]) + origin.x,
        y = (ent.position.y or ent.position[2]) + origin.y,
      }
      local found = surface.find_entity(ent.name, pos)
      if not (found and found.valid) then
        local nearby = surface.find_entities_filtered({
          position = pos,
          radius = 0.45,
          name = ent.name,
          force = game.forces.player,
        })
        found = nearby[1]
      end
      if found and found.valid then
        by_number[ent.entity_number] = found
      end
    end
  end
  return by_number
end

--- Apply blueprint wires: {src_entity, src_connector, dst_entity, dst_connector}.
local function connect_wires(by_number, wires)
  if not wires or #wires == 0 then
    log("wires: none")
    return
  end
  local ok_n = 0
  local fail_n = 0
  for _, w in pairs(wires) do
    local e1n, c1, e2n, c2 = w[1], w[2], w[3], w[4]
    local e1 = by_number[e1n]
    local e2 = by_number[e2n]
    if e1 and e1.valid and e2 and e2.valid then
      local a = e1.get_wire_connector(c1, true)
      local b = e2.get_wire_connector(c2, true)
      if a and b and (a.is_connected_to(b) or a.connect_to(b, false)) then
        ok_n = ok_n + 1
      else
        fail_n = fail_n + 1
        log(
          string.format(
            "wire connect failed %s#%s <-> %s#%s",
            tostring(e1 and e1.name),
            tostring(c1),
            tostring(e2 and e2.name),
            tostring(c2)
          )
        )
      end
    else
      fail_n = fail_n + 1
      log(string.format("wire skip missing entity %s <-> %s", tostring(e1n), tostring(e2n)))
    end
  end
  log(string.format("wires: connected=%d failed=%d total=%d", ok_n, fail_n, #wires))
end

local function place_tiles(surface, bp_tiles, origin)
  if not bp_tiles or #bp_tiles == 0 then
    return
  end
  local tiles = {}
  for _, t in pairs(bp_tiles) do
    local px = (t.position.x or t.position[1]) + origin.x
    local py = (t.position.y or t.position[2]) + origin.y
    table.insert(tiles, { name = t.name, position = { x = px, y = py } })
  end
  surface.set_tiles(tiles, true, false, true, true)
  log("placed " .. #tiles .. " blueprint tiles")
end

local function build_blueprint(surface, blueprint_string, wires)
  if type(blueprint_string) ~= "string" or blueprint_string == "" then
    fail("empty blueprint string")
    return false
  end

  local inv = game.create_inventory(1)
  local stack = inv[1]
  local import_result = stack.import_stack(blueprint_string)
  if import_result == 1 then
    inv.destroy()
    fail("import_stack failed (result=1)")
    return false
  end
  log("import_stack result=" .. tostring(import_result))

  if not stack.valid_for_read then
    inv.destroy()
    fail("imported stack is empty / invalid_for_read")
    return false
  end

  log(
    string.format(
      "stack name=%s is_blueprint=%s is_book=%s setup=%s entity_count=%s",
      tostring(stack.name),
      tostring(stack.is_blueprint),
      tostring(stack.is_blueprint_book),
      tostring(stack.is_blueprint_setup and stack.is_blueprint_setup() or "n/a"),
      tostring(stack.get_blueprint_entity_count and stack.get_blueprint_entity_count() or "n/a")
    )
  )

  if stack.is_blueprint_book then
    inv.destroy()
    fail("blueprint books are not supported by this rig yet")
    return false
  end

  local origin = { x = 0, y = 0 }
  local ghosts = stack.build_blueprint({
    surface = surface,
    force = game.forces.player,
    position = origin,
    build_mode = defines.build_mode.superforced,
    skip_fog_of_war = true,
  })
  log("build_blueprint created " .. tostring(#ghosts) .. " ghosts")

  local bp_entities = stack.get_blueprint_entities() or {}
  local bp_tiles = stack.get_blueprint_tiles()
  inv.destroy()

  local by_number
  if #ghosts == 0 and #bp_entities > 0 then
    log("build_blueprint returned no ghosts; falling back to create_entity")
    by_number = place_entities_directly(surface, bp_entities, origin)
  else
    revive_all(surface)
    by_number = map_entities_by_number(surface, bp_entities, origin)
  end

  place_tiles(surface, bp_tiles, origin)
  connect_wires(by_number, wires)
  return true
end

local function entity_bbox(surface)
  local min_x, min_y, max_x, max_y = nil, nil, nil, nil
  local count = 0

  local entities = surface.find_entities_filtered({ force = game.forces.player })
  for _, entity in pairs(entities) do
    if entity.valid then
      local t = entity.type
      if t ~= "character" and t ~= "entity-ghost" and t ~= "tile-ghost" and t ~= "item-request-proxy" then
        min_x, min_y, max_x, max_y = expand_bbox(entity.selection_box, min_x, min_y, max_x, max_y)
        min_x, min_y, max_x, max_y = expand_bbox(entity.bounding_box, min_x, min_y, max_x, max_y)
        count = count + 1
      end
    end
  end

  if count == 0 or min_x == nil then
    log("no built entities; falling back to 4x4 around origin")
    return { min_x = -2, min_y = -2, max_x = 2, max_y = 2, count = 0 }
  end

  log(
    string.format(
      "bbox entities=%d (%.2f,%.2f)-(%.2f,%.2f)",
      count,
      min_x,
      min_y,
      max_x,
      max_y
    )
  )
  return { min_x = min_x, min_y = min_y, max_x = max_x, max_y = max_y, count = count }
end

local function clear_characters(surface)
  for _, entity in pairs(surface.find_entities_filtered({ type = "character" })) do
    if entity.valid then
      entity.destroy({ raise_destroy = false })
    end
  end
end

local function take_shot(surface, bbox, job, default_zoom)
  clear_characters(surface)
  local zoom = tonumber(job.zoom) or tonumber(default_zoom) or 2
  if zoom <= 0 then
    zoom = 2
  end

  local width_tiles = (bbox.max_x - bbox.min_x)
  local height_tiles = (bbox.max_y - bbox.min_y)
  if width_tiles < 1 then
    width_tiles = 1
  end
  if height_tiles < 1 then
    height_tiles = 1
  end

  local res_x = math.ceil(width_tiles * PX_PER_TILE_AT_ZOOM_1 * zoom)
  local res_y = math.ceil(height_tiles * PX_PER_TILE_AT_ZOOM_1 * zoom)

  while (res_x > MAX_RES or res_y > MAX_RES) and zoom > 0.25 do
    zoom = zoom * 0.5
    res_x = math.ceil(width_tiles * PX_PER_TILE_AT_ZOOM_1 * zoom)
    res_y = math.ceil(height_tiles * PX_PER_TILE_AT_ZOOM_1 * zoom)
    log("resolution too large; reduced zoom to " .. tostring(zoom))
  end

  res_x = math.max(1, math.min(MAX_RES, res_x))
  res_y = math.max(1, math.min(MAX_RES, res_y))

  local cx = (bbox.min_x + bbox.max_x) / 2
  local cy = (bbox.min_y + bbox.max_y) / 2
  local name = tostring(job.name or "untitled")
  local show_info = job.show_entity_info and true or false
  local path = "fpsr-rig/" .. name .. ".png"

  log(
    string.format(
      "take_screenshot path=%s res=%dx%d zoom=%.3f pos=(%.2f,%.2f) alt=%s view=(%.2f,%.2f)-(%.2f,%.2f)",
      path,
      res_x,
      res_y,
      zoom,
      cx,
      cy,
      tostring(show_info),
      bbox.min_x,
      bbox.min_y,
      bbox.max_x,
      bbox.max_y
    )
  )

  game.take_screenshot({
    surface = surface,
    position = { cx, cy },
    resolution = { x = res_x, y = res_y },
    zoom = zoom,
    path = path,
    show_entity_info = show_info,
    anti_alias = false,
    hide_clouds = true,
    hide_fog = true,
    daytime = 0,
    water_tick = 0,
    force_render = true,
  })
  game.set_wait_for_screenshots_to_finish()
  print(SENTINEL_SHOT .. ":" .. name)
  log("screenshot queued+waited for " .. name)
end

--- Prefer fpsr-planned tile frame (min_x..max_y); else fall back to entity bbox + pad.
local function resolve_bbox(surface, job)
  if job.min_x ~= nil and job.min_y ~= nil and job.max_x ~= nil and job.max_y ~= nil then
    local bbox = {
      min_x = tonumber(job.min_x),
      min_y = tonumber(job.min_y),
      max_x = tonumber(job.max_x),
      max_y = tonumber(job.max_y),
      count = -1,
    }
    log(
      string.format(
        "using fpsr view (%.2f,%.2f)-(%.2f,%.2f)",
        bbox.min_x,
        bbox.min_y,
        bbox.max_x,
        bbox.max_y
      )
    )
    return bbox
  end
  local bbox = entity_bbox(surface)
  bbox.min_x = bbox.min_x - PAD_TILES
  bbox.min_y = bbox.min_y - PAD_TILES
  bbox.max_x = bbox.max_x + PAD_TILES
  bbox.max_y = bbox.max_y + PAD_TILES
  return bbox
end

local function current_job()
  return storage.jobs[storage.job_index]
end

script.on_init(function()
  storage.phase = "build"
  storage.done = false
  storage.settle_left = SETTLE_TICKS
  storage.surface_name = nil
  storage.jobs = jobs_file.jobs or {}
  storage.default_zoom = jobs_file.zoom or 2
  storage.job_index = 1
  if #storage.jobs == 0 then
    fail("jobs.lua has no jobs")
  else
    log(string.format("loaded %d job(s)", #storage.jobs))
  end
end)

script.on_event(defines.events.on_tick, function()
  if storage.done then
    return
  end

  local ok, err = pcall(function()
    if storage.phase == "build" then
      local job = current_job()
      if not job then
        fail("missing job at index " .. tostring(storage.job_index))
        return
      end
      log(
        string.format(
          "job %d/%d name=%s",
          storage.job_index,
          #storage.jobs,
          tostring(job.name)
        )
      )
      -- Unique surface per job (delete_surface is async; same name cannot be reused immediately).
      local surface = setup_surface(storage.job_index)
      storage.surface_name = surface.name
      if not build_blueprint(surface, job.blueprint, job.wires) then
        return
      end
      storage.phase = "settle"
      storage.settle_left = SETTLE_TICKS
      return
    end

    if storage.phase == "settle" then
      storage.settle_left = storage.settle_left - 1
      if storage.settle_left > 0 then
        return
      end
      local surface = game.surfaces[storage.surface_name]
      local bbox = resolve_bbox(surface, current_job())
      take_shot(surface, bbox, current_job(), storage.default_zoom)

      if storage.job_index < #storage.jobs then
        storage.job_index = storage.job_index + 1
        storage.phase = "build"
        return
      end

      print(SENTINEL_DONE)
      log("all jobs complete; sentinel printed")
      storage.done = true
      storage.phase = "done"
    end
  end)

  if not ok then
    fail(err)
  end
end)

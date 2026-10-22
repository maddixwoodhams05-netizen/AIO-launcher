// Pulls the biggest icon out of a Windows EXE file.
// Only the small parts of the file that hold the icon are read, so this
// stays quick even for huge game EXEs.
const fs = require('fs/promises');

const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const MAX_RSRC_SIZE = 64 * 1024 * 1024;

async function readAt(file, offset, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await file.read(buf, 0, length, offset);
  return buf.subarray(0, bytesRead);
}

// Lists the entries of one resource directory inside the .rsrc section.
function dirEntries(dirs, offset) {
  const named = dirs.readUInt16LE(offset + 12);
  const ids = dirs.readUInt16LE(offset + 14);
  const entries = [];
  for (let i = 0; i < named + ids; i++) {
    const at = offset + 16 + i * 8;
    const name = dirs.readUInt32LE(at);
    const target = dirs.readUInt32LE(at + 4);
    entries.push({
      id: name & 0x80000000 ? null : name,
      isDir: Boolean(target & 0x80000000),
      offset: target & 0x7fffffff,
    });
  }
  return entries;
}

// Follows a resource entry down to its first language and returns its bytes.
// dirs is the resource directory; rsrc is the whole section it sits in.
function entryData(dirs, rsrc, section, entry) {
  while (entry.isDir) {
    entry = dirEntries(dirs, entry.offset)[0];
    if (!entry) return null;
  }
  const rva = dirs.readUInt32LE(entry.offset);
  const size = dirs.readUInt32LE(entry.offset + 4);
  const start = rva - section.virtualAddress;
  if (start < 0 || start + size > rsrc.length) return null;
  return rsrc.subarray(start, start + size);
}

// Returns the EXE's biggest icon as a data: URL, or null if it has none.
async function extractIcon(exePath) {
  const file = await fs.open(exePath, 'r');
  try {
    const dos = await readAt(file, 0, 64);
    if (dos.length < 64 || dos.toString('latin1', 0, 2) !== 'MZ') return null;
    const peOffset = dos.readUInt32LE(0x3c);

    const header = await readAt(file, peOffset, 24 + 240);
    if (header.toString('latin1', 0, 4) !== 'PE\0\0') return null;
    const sectionCount = header.readUInt16LE(6);
    const optionalSize = header.readUInt16LE(20);
    const is64 = header.readUInt16LE(24) === 0x20b;
    const resourceRva = header.readUInt32LE(24 + (is64 ? 128 : 112));
    if (!resourceRva) return null;

    const table = await readAt(file, peOffset + 24 + optionalSize, sectionCount * 40);
    let section = null;
    for (let i = 0; i < sectionCount; i++) {
      const at = i * 40;
      const virtualAddress = table.readUInt32LE(at + 12);
      const virtualSize = table.readUInt32LE(at + 8);
      const rawSize = table.readUInt32LE(at + 16);
      if (resourceRva >= virtualAddress && resourceRva < virtualAddress + Math.max(virtualSize, rawSize)) {
        section = { virtualAddress, rawSize, rawOffset: table.readUInt32LE(at + 20) };
        break;
      }
    }
    if (!section || section.rawSize > MAX_RSRC_SIZE) return null;

    const rsrc = await readAt(file, section.rawOffset, section.rawSize);
    // Offsets inside the resource directory count from where it starts.
    const dirs = rsrc.subarray(resourceRva - section.virtualAddress);
    const types = dirEntries(dirs, 0);
    const typeDir = (type) => types.find((t) => t.id === type && t.isDir);

    const groupType = typeDir(RT_GROUP_ICON);
    const iconType = typeDir(RT_ICON);
    if (!groupType || !iconType) return null;

    // The first icon group is the one Windows shows for the EXE.
    const group = entryData(dirs, rsrc, section, dirEntries(dirs, groupType.offset)[0]);
    if (!group || group.length < 6) return null;
    const count = group.readUInt16LE(4);

    let best = null;
    for (let i = 0; i < count; i++) {
      const at = 6 + i * 14;
      if (at + 14 > group.length) break;
      const icon = {
        width: group[at] || 256,
        height: group[at + 1] || 256,
        colorCount: group[at + 2],
        planes: group.readUInt16LE(at + 4),
        bitCount: group.readUInt16LE(at + 6),
        id: group.readUInt16LE(at + 12),
      };
      if (!best || icon.width > best.width || (icon.width === best.width && icon.bitCount > best.bitCount)) {
        best = icon;
      }
    }
    if (!best) return null;

    const iconEntry = dirEntries(dirs, iconType.offset).find((e) => e.id === best.id);
    const data = iconEntry && entryData(dirs, rsrc, section, iconEntry);
    if (!data) return null;

    // Big icons are often stored as PNGs, which can be shown directly.
    if (data.subarray(0, 4).toString('latin1') === '\x89PNG') {
      return `data:image/png;base64,${data.toString('base64')}`;
    }

    // Otherwise wrap the image in a one-icon .ico file.
    const ico = Buffer.alloc(22);
    ico.writeUInt16LE(0, 0);
    ico.writeUInt16LE(1, 2);
    ico.writeUInt16LE(1, 4);
    ico[6] = best.width >= 256 ? 0 : best.width;
    ico[7] = best.height >= 256 ? 0 : best.height;
    ico[8] = best.colorCount;
    ico.writeUInt16LE(best.planes, 10);
    ico.writeUInt16LE(best.bitCount, 12);
    ico.writeUInt32LE(data.length, 14);
    ico.writeUInt32LE(22, 18);
    return `data:image/x-icon;base64,${Buffer.concat([ico, data]).toString('base64')}`;
  } catch {
    return null;
  } finally {
    await file.close();
  }
}

module.exports = { extractIcon };

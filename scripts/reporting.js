(function () {
  const COLORS = {
    blue: "1F3864",
    gold: "D6A838",
    gray: "666666",
    lightGray: "F8FAFC",
    border: "E2E8F0",
    green: "107C41",
    amber: "C55A11",
    red: "C00000",
    white: "FFFFFF",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function xmlEscape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function truncate(value, length = 90) {
    const text = String(value ?? "").trim();
    return text.length > length ? `${text.slice(0, length - 3)}...` : text;
  }

  function downloadBlobFile(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadTextFile(filename, content, type) {
    const blob = new Blob([content], { type });
    downloadBlobFile(filename, blob);
  }

  function parseReportPercent(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text || text === "--") return null;
    const match = text.replace(/\s/g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatReportPercent(value) {
    return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value)}%`;
  }

  function reportAchievement(kpi = {}) {
    const explicit = Number(kpi.vsTargetValue);
    const value = Number.isFinite(explicit) ? explicit : parseReportPercent(kpi.vsTargetLabel);
    if (!Number.isFinite(value)) {
      return { value: null, label: "--", className: "gray" };
    }
    return {
      value,
      label: formatReportPercent(value),
      className: value >= 100 ? "green" : value >= 90 ? "amber" : "red",
    };
  }

  function statusColor(status) {
    if (status === "red") return COLORS.red;
    if (status === "amber") return COLORS.amber;
    if (status === "green") return COLORS.green;
    return COLORS.gray;
  }

  function reportCriticalKpis(kpis = [], limit = 5) {
    return [
      ...kpis.filter((kpi) => kpi.status === "red"),
      ...kpis.filter((kpi) => kpi.status === "amber"),
    ].slice(0, limit);
  }

  function kpiAction(kpi = {}) {
    const achievement = reportAchievement(kpi);
    if (kpi.status === "red" || achievement.className === "red") {
      return "Action corrective prioritaire et commentaire obligatoire avant validation.";
    }
    if (kpi.status === "amber" || achievement.className === "amber") {
      return "Analyse preventive, cause racine et suivi au prochain reporting.";
    }
    return "Maintenir le suivi et documenter les faits marquants.";
  }

  function scoreClass(score) {
    const numeric = Number(score);
    if (!Number.isFinite(numeric)) return "gray";
    if (numeric >= 80) return "green";
    if (numeric >= 70) return "amber";
    return "red";
  }

  function scoreFromKpis(kpis = []) {
    const measured = kpis.filter((kpi) => ["green", "amber", "red"].includes(kpi.status));
    if (!measured.length) return null;
    const weights = { green: 100, amber: 70, red: 35 };
    return Math.round(measured.reduce((sum, kpi) => sum + (weights[kpi.status] || 0), 0) / measured.length);
  }

  function crc32(bytes) {
    if (!crc32.table) {
      crc32.table = Array.from({ length: 256 }, (_, index) => {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
          value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        return value >>> 0;
      });
    }
    let crc = 0xffffffff;
    bytes.forEach((byte) => {
      crc = crc32.table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    });
    return (crc ^ 0xffffffff) >>> 0;
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    parts.forEach((part) => {
      output.set(part, offset);
      offset += part.length;
    });
    return output;
  }

  function zipHeader(signature, fields) {
    const bytes = new Uint8Array(fields.reduce((sum, field) => sum + field.size, 4));
    const view = new DataView(bytes.buffer);
    let offset = 0;
    view.setUint32(offset, signature, true);
    offset += 4;
    fields.forEach((field) => {
      if (field.size === 2) view.setUint16(offset, field.value, true);
      if (field.size === 4) view.setUint32(offset, field.value >>> 0, true);
      offset += field.size;
    });
    return bytes;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { dosTime, dosDate };
  }

  function createStoredZip(files) {
    const encoder = new TextEncoder();
    const now = dosDateTime();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach((file) => {
      const nameBytes = encoder.encode(file.name);
      const dataBytes = file.data instanceof Uint8Array ? file.data : encoder.encode(file.data);
      const crc = crc32(dataBytes);
      const localHeader = zipHeader(0x04034b50, [
        { value: 20, size: 2 },
        { value: 0, size: 2 },
        { value: 0, size: 2 },
        { value: now.dosTime, size: 2 },
        { value: now.dosDate, size: 2 },
        { value: crc, size: 4 },
        { value: dataBytes.length, size: 4 },
        { value: dataBytes.length, size: 4 },
        { value: nameBytes.length, size: 2 },
        { value: 0, size: 2 },
      ]);
      localParts.push(localHeader, nameBytes, dataBytes);

      const centralHeader = zipHeader(0x02014b50, [
        { value: 20, size: 2 },
        { value: 20, size: 2 },
        { value: 0, size: 2 },
        { value: 0, size: 2 },
        { value: now.dosTime, size: 2 },
        { value: now.dosDate, size: 2 },
        { value: crc, size: 4 },
        { value: dataBytes.length, size: 4 },
        { value: dataBytes.length, size: 4 },
        { value: nameBytes.length, size: 2 },
        { value: 0, size: 2 },
        { value: 0, size: 2 },
        { value: 0, size: 2 },
        { value: 0, size: 2 },
        { value: 0, size: 4 },
        { value: offset, size: 4 },
      ]);
      centralParts.push(centralHeader, nameBytes);
      offset += localHeader.length + nameBytes.length + dataBytes.length;
    });

    const centralDirectory = concatBytes(centralParts);
    const localData = concatBytes(localParts);
    const end = zipHeader(0x06054b50, [
      { value: 0, size: 2 },
      { value: 0, size: 2 },
      { value: files.length, size: 2 },
      { value: files.length, size: 2 },
      { value: centralDirectory.length, size: 4 },
      { value: localData.length, size: 4 },
      { value: 0, size: 2 },
    ]);
    return concatBytes([localData, centralDirectory, end]);
  }

  function pptxTextShape(id, text, x, y, cx, cy, options = {}) {
    const fontSize = Number(options.fontSize || 1800);
    const color = String(options.color || COLORS.blue).replace("#", "");
    const fill = options.fill ? `<a:solidFill><a:srgbClr val="${xmlEscape(options.fill).replace("#", "")}"/></a:solidFill>` : "";
    const border = options.border ? `<a:ln w="12700"><a:solidFill><a:srgbClr val="${xmlEscape(options.border).replace("#", "")}"/></a:solidFill></a:ln>` : "";
    const paragraphs = String(text ?? "")
      .split(/\r?\n/)
      .map((line) => `
        <a:p>
          <a:pPr algn="${options.align || "l"}"/>
          <a:r>
            <a:rPr lang="fr-FR" sz="${fontSize}"${options.bold ? ' b="1"' : ""}>
              <a:solidFill><a:srgbClr val="${xmlEscape(color)}"/></a:solidFill>
            </a:rPr>
            <a:t>${xmlEscape(line)}</a:t>
          </a:r>
          <a:endParaRPr lang="fr-FR" sz="${fontSize}"/>
        </a:p>
      `)
      .join("");
    return `
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="${id}" name="Text ${id}"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          ${fill}
          ${border}
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" lIns="110000" tIns="70000" rIns="110000" bIns="70000"/>
          <a:lstStyle/>
          ${paragraphs}
        </p:txBody>
      </p:sp>
    `;
  }

  function pptxSlideXml(shapes) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld>
          <p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
          <p:spTree>
            <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
            <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
            ${shapes.join("")}
          </p:spTree>
        </p:cSld>
        <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
      </p:sld>`;
  }

  function pptxSlideRels() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      </Relationships>`;
  }

  function pptxPackage(slides, title) {
    const slideCount = slides.length;
    const overrides = slides
      .map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
      .join("");
    const slideIds = slides
      .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`)
      .join("");
    const slideRels = slides
      .map((_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`)
      .join("");
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
        <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
        <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
        <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
        <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
        <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
        ${overrides}
      </Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
        <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
      </Relationships>`;
    const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Palladium Africa Control Tower</Application><PresentationFormat>Wide</PresentationFormat><Slides>${slideCount}</Slides></Properties>`;
    const now = new Date().toISOString();
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>Palladium Africa Control Tower</dc:creator><cp:lastModifiedBy>Palladium Africa Control Tower</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
    const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
        <p:sldIdLst>${slideIds}</p:sldIdLst>
        <p:sldSz cx="12192000" cy="6858000" type="wide"/><p:notesSz cx="6858000" cy="9144000"/>
      </p:presentation>`;
    const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
        ${slideRels}
      </Relationships>`;
    const slideMaster = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
        <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
        <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
        <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
      </p:sldMaster>`;
    const slideMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`;
    const slideLayout = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
    const slideLayoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;
    const theme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Palladium Africa Control Tower"><a:themeElements><a:clrScheme name="Palladium Africa"><a:dk1><a:srgbClr val="1F3864"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="111827"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="D6A838"/></a:accent1><a:accent2><a:srgbClr val="1F3864"/></a:accent2><a:accent3><a:srgbClr val="107C41"/></a:accent3><a:accent4><a:srgbClr val="C55A11"/></a:accent4><a:accent5><a:srgbClr val="C00000"/></a:accent5><a:accent6><a:srgbClr val="64748B"/></a:accent6><a:hlink><a:srgbClr val="1F3864"/></a:hlink><a:folHlink><a:srgbClr val="1F3864"/></a:folHlink></a:clrScheme><a:fontScheme name="Arial"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="Palladium Africa"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

    const files = [
      { name: "[Content_Types].xml", data: contentTypes },
      { name: "_rels/.rels", data: rels },
      { name: "docProps/app.xml", data: app },
      { name: "docProps/core.xml", data: core },
      { name: "ppt/presentation.xml", data: presentation },
      { name: "ppt/_rels/presentation.xml.rels", data: presentationRels },
      ...slides.map((slide, index) => ({ name: `ppt/slides/slide${index + 1}.xml`, data: slide })),
      ...slides.map((_, index) => ({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: pptxSlideRels() })),
      { name: "ppt/slideMasters/slideMaster1.xml", data: slideMaster },
      { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: slideMasterRels },
      { name: "ppt/slideLayouts/slideLayout1.xml", data: slideLayout },
      { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: slideLayoutRels },
      { name: "ppt/theme/theme1.xml", data: theme },
    ];

    return new Blob([createStoredZip(files)], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
  }

  function headerShape(title, subtitle = "") {
    const margin = 520000;
    return [
      pptxTextShape(2, "PALLADIUM AFRICA CONTROL TOWER", margin, 260000, 4300000, 360000, { fontSize: 1250, bold: true, color: COLORS.gold }),
      pptxTextShape(3, title, margin, 640000, 7600000, 540000, { fontSize: 2450, bold: true, color: COLORS.blue }),
      subtitle ? pptxTextShape(4, subtitle, margin, 1180000, 8600000, 350000, { fontSize: 1150, color: COLORS.gray }) : "",
    ].filter(Boolean);
  }

  function metricCard(id, label, value, x, y, className = "gray", hint = "") {
    return pptxTextShape(
      id,
      `${label}\n${value}${hint ? `\n${hint}` : ""}`,
      x,
      y,
      2500000,
      1020000,
      { fontSize: 1550, bold: true, color: statusColor(className), fill: className === "gray" ? COLORS.lightGray : "FFF7D6", border: statusColor(className) }
    );
  }

  function buildKpiTableShapes(rows = [], options = {}) {
    const margin = 520000;
    const y0 = options.y || 1500000;
    const columns = options.columns || [
      { title: "KPI", x: margin, w: 3600000 },
      { title: "Valeur", x: margin + 3600000, w: 1500000 },
      { title: "Objectif", x: margin + 5100000, w: 1700000 },
      { title: "Taux", x: margin + 6800000, w: 1300000 },
      { title: "Tendance", x: margin + 8100000, w: 2500000 },
    ];
    const shapes = columns.map((col, index) =>
      pptxTextShape(10 + index, col.title, col.x, y0, col.w, 390000, { fontSize: 1050, bold: true, color: COLORS.white, fill: COLORS.blue })
    );
    rows.slice(0, options.limit || 10).forEach((row, rowIndex) => {
      const y = y0 + 420000 + rowIndex * 430000;
      const fill = rowIndex % 2 ? COLORS.white : COLORS.lightGray;
      const id = 50 + rowIndex * columns.length;
      columns.forEach((col, colIndex) => {
        const value = typeof col.value === "function" ? col.value(row) : row[col.value];
        const className = typeof col.className === "function" ? col.className(row) : "";
        shapes.push(
          pptxTextShape(id + colIndex, value || "--", col.x, y, col.w, 390000, {
            fontSize: col.fontSize || 950,
            bold: Boolean(col.bold || className),
            color: className ? statusColor(className) : COLORS.blue,
            fill,
            border: COLORS.border,
          })
        );
      });
    });
    if (!rows.length) {
      shapes.push(pptxTextShape(100, options.empty || "Aucune donnee disponible pour ce rapport.", margin, y0 + 520000, 6400000, 520000, { fontSize: 1500, color: COLORS.gray }));
    }
    return shapes;
  }

  function buildPoleReportPptx(context) {
    const critical = reportCriticalKpis(context.kpis, 8);
    const generatedAt = new Date().toLocaleString("fr-FR");
    const title = `Rapport ${context.cycle.value} - ${context.pole.name}`;
    const score = context.pole.score ?? scoreFromKpis(context.kpis);
    const targetValues = context.kpis.map(reportAchievement).filter((item) => Number.isFinite(item.value));
    const targetRate = targetValues.length
      ? Math.round((targetValues.filter((item) => item.value >= 100).length / targetValues.length) * 100)
      : null;
    const slides = [];

    slides.push(
      pptxSlideXml([
        ...headerShape(title, `Periode: ${context.period} | Responsable: ${context.pole.owner || "A affecter"} | Genere le: ${generatedAt}`),
        metricCard(20, "Score", score ?? "--", 520000, 1900000, scoreClass(score)),
        metricCard(21, "KPI suivis", context.kpis.length, 3200000, 1900000, context.kpis.length ? "green" : "gray"),
        metricCard(22, "KPI critiques", critical.length, 5880000, 1900000, critical.some((item) => item.status === "red") ? "red" : critical.length ? "amber" : "green"),
        metricCard(23, "Objectifs atteints", targetRate === null ? "--" : `${targetRate}%`, 8560000, 1900000, targetRate === null ? "gray" : scoreClass(targetRate)),
        pptxTextShape(30, `Commentaire responsable\n${context.comment || "A completer par le responsable du pole."}`, 520000, 3500000, 11000000, 1050000, { fontSize: 1250, color: COLORS.blue, fill: "FFF7D6", border: COLORS.gold }),
        pptxTextShape(31, `Synthese\n${critical.length ? `${critical.length} KPI rouge/orange a suivre avec plan d'action.` : "Aucun KPI critique dans le perimetre exporte."}`, 520000, 4850000, 11000000, 820000, { fontSize: 1250, color: COLORS.gray, fill: COLORS.lightGray, border: COLORS.border }),
      ])
    );

    slides.push(
      pptxSlideXml([
        ...headerShape("Lecture complete des KPI", `${context.pole.name} | ${context.period}`),
        ...buildKpiTableShapes(context.kpis, {
          y: 1550000,
          limit: 11,
          columns: [
            { title: "KPI", x: 520000, w: 3300000, value: (kpi) => truncate(kpi.name, 48) },
            { title: "Valeur", x: 3820000, w: 1500000, value: (kpi) => truncate(kpi.value, 18) },
            { title: "Objectif", x: 5320000, w: 1650000, value: (kpi) => truncate(kpi.target, 20) },
            { title: "Taux realise", x: 6970000, w: 1400000, value: (kpi) => reportAchievement(kpi).label, className: (kpi) => reportAchievement(kpi).className, bold: true },
            { title: "Tendance", x: 8370000, w: 2800000, value: (kpi) => truncate(kpi.trend || "--", 35) },
          ],
        }),
      ])
    );

    slides.push(
      pptxSlideXml([
        ...headerShape("Plan d'action KPI rouges / oranges", "Les lignes critiques sont a commenter et suivre avant validation."),
        ...buildKpiTableShapes(critical, {
          y: 1550000,
          limit: 7,
          empty: "Aucun KPI rouge ou orange a transformer en plan d'action.",
          columns: [
            { title: "KPI", x: 520000, w: 3000000, value: (kpi) => truncate(kpi.name, 42) },
            { title: "Taux", x: 3520000, w: 1100000, value: (kpi) => reportAchievement(kpi).label, className: (kpi) => reportAchievement(kpi).className, bold: true },
            { title: "Responsable", x: 4620000, w: 2100000, value: () => truncate(context.pole.owner || "A affecter", 28) },
            { title: "Action proposee", x: 6720000, w: 4500000, value: (kpi) => truncate(kpiAction(kpi), 70) },
          ],
        }),
      ])
    );

    return pptxPackage(slides, title);
  }

  function buildManagementReportPptx(context) {
    const generatedAt = new Date().toLocaleString("fr-FR");
    const title = "Rapport Management groupe";
    const score = context.score ?? scoreFromKpis(context.kpis);
    const critical = context.priorities || reportCriticalKpis(context.kpis, 5);
    const targetValues = context.kpis.map(reportAchievement).filter((item) => Number.isFinite(item.value));
    const targetRate = targetValues.length
      ? Math.round((targetValues.filter((item) => item.value >= 100).length / targetValues.length) * 100)
      : null;
    const redCount = context.kpis.filter((kpi) => kpi.status === "red").length;
    const amberCount = context.kpis.filter((kpi) => kpi.status === "amber").length;
    const greenCount = context.kpis.filter((kpi) => kpi.status === "green").length;
    const bestDirection = [...(context.directionScores || [])]
      .filter((item) => Number.isFinite(Number(item.score)))
      .sort((left, right) => Number(right.score) - Number(left.score))[0];
    const watchDirection = [...(context.directionScores || [])]
      .filter((item) => Number.isFinite(Number(item.score)))
      .sort((left, right) => Number(left.score) - Number(right.score))[0];
    const decision = critical[0];
    const slides = [];

    slides.push(
      pptxSlideXml([
        ...headerShape(title, `${context.country || "Groupe"} | ${context.period || ""} | Genere le: ${generatedAt}`),
        metricCard(20, "Score groupe", score ?? "--", 520000, 1750000, scoreClass(score)),
        metricCard(21, "KPI calcules", context.kpis.filter((kpi) => ["green", "amber", "red"].includes(kpi.status)).length, 3200000, 1750000, context.kpis.length ? "green" : "gray"),
        metricCard(22, "Rouge / Orange", `${redCount}/${amberCount}`, 5880000, 1750000, redCount ? "red" : amberCount ? "amber" : context.kpis.length ? "green" : "gray"),
        metricCard(23, "Cibles atteintes", targetRate === null ? "--" : `${targetRate}%`, 8560000, 1750000, targetRate === null ? "gray" : scoreClass(targetRate)),
        pptxTextShape(30, `Ce qui va bien\n${bestDirection ? `${bestDirection.poleName} affiche le meilleur score (${bestDirection.score}/100). ${greenCount} KPI sont au vert.` : "Les points forts seront visibles apres calcul des donnees Kobo."}`, 520000, 3250000, 5200000, 950000, { fontSize: 1200, color: COLORS.green, fill: "E8F5EE", border: COLORS.green }),
        pptxTextShape(31, `Ce qui bloque\n${redCount || amberCount ? `${redCount} KPI rouges et ${amberCount} KPI orange a traiter.` : "Aucun blocage critique detecte dans le perimetre."}`, 5880000, 3250000, 5200000, 950000, { fontSize: 1200, color: redCount ? COLORS.red : COLORS.amber, fill: "FFF7D6", border: redCount ? COLORS.red : COLORS.amber }),
        pptxTextShape(32, `Decision attendue\n${decision ? `${kpiAction(decision)} Priorite: ${decision.poleName || decision.poleId || ""} / ${decision.name}.` : "Maintenir le rythme de collecte et valider les rapports de la periode."}`, 520000, 4450000, 11000000, 960000, { fontSize: 1200, color: COLORS.blue, fill: COLORS.lightGray, border: COLORS.border }),
      ])
    );

    slides.push(
      pptxSlideXml([
        ...headerShape("Score par direction / pole", watchDirection ? `Pole a surveiller: ${watchDirection.poleName} (${watchDirection.score}/100)` : "Score disponible apres calcul Kobo."),
        ...buildKpiTableShapes(context.directionScores || [], {
          y: 1550000,
          limit: 11,
          columns: [
            { title: "Direction / Pole", x: 520000, w: 3600000, value: (row) => truncate(row.poleName || row.poleId, 45) },
            { title: "Score", x: 4120000, w: 1200000, value: (row) => Number.isFinite(Number(row.score)) ? `${Math.round(Number(row.score))}/100` : "--", className: (row) => scoreClass(row.score), bold: true },
            { title: "KPI", x: 5320000, w: 1000000, value: (row) => row.total || "--" },
            { title: "R/O/V", x: 6320000, w: 1300000, value: (row) => `${row.red || 0}/${row.amber || 0}/${row.green || 0}` },
            { title: "Action", x: 7620000, w: 3600000, value: (row) => truncate(row.action || "Suivi periodique", 52) },
          ],
        }),
      ])
    );

    slides.push(
      pptxSlideXml([
        ...headerShape("Top priorites de la periode", "KPI critiques a traiter en premier."),
        ...buildKpiTableShapes(critical, {
          y: 1550000,
          limit: 7,
          empty: "Aucune priorite critique detectee.",
          columns: [
            { title: "Pole", x: 520000, w: 1700000, value: (kpi) => truncate(kpi.poleId || kpi.poleName || "--", 22) },
            { title: "KPI", x: 2220000, w: 3000000, value: (kpi) => truncate(kpi.name, 42) },
            { title: "Taux", x: 5220000, w: 1200000, value: (kpi) => reportAchievement(kpi).label, className: (kpi) => reportAchievement(kpi).className, bold: true },
            { title: "Objectif", x: 6420000, w: 1700000, value: (kpi) => truncate(kpi.target, 20) },
            { title: "Action proposee", x: 8120000, w: 3200000, value: (kpi) => truncate(kpiAction(kpi), 48) },
          ],
        }),
      ])
    );

    slides.push(
      pptxSlideXml([
        ...headerShape("Detail KPI", "Lecture executive des principaux KPI calcules."),
        ...buildKpiTableShapes(context.kpis, {
          y: 1550000,
          limit: 11,
          columns: [
            { title: "Pole", x: 520000, w: 1300000, value: (kpi) => truncate(kpi.poleId || "--", 16) },
            { title: "KPI", x: 1820000, w: 3000000, value: (kpi) => truncate(kpi.name, 42) },
            { title: "Valeur", x: 4820000, w: 1500000, value: (kpi) => truncate(kpi.value, 18) },
            { title: "Objectif", x: 6320000, w: 1600000, value: (kpi) => truncate(kpi.target, 20) },
            { title: "Taux realise", x: 7920000, w: 1400000, value: (kpi) => reportAchievement(kpi).label, className: (kpi) => reportAchievement(kpi).className, bold: true },
            { title: "Statut", x: 9320000, w: 1700000, value: (kpi) => kpi.status || "--", className: (kpi) => kpi.status },
          ],
        }),
      ])
    );

    return pptxPackage(slides, title);
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function buildReportTableRows(kpis = []) {
    return kpis
      .map((kpi) => {
        const achievement = reportAchievement(kpi);
        return `
          <tr>
            <td>${escapeHtml(kpi.name)}</td>
            <td>${escapeHtml(kpi.value)}</td>
            <td>${escapeHtml(kpi.target)}</td>
            <td>${escapeHtml(kpi.trend)}</td>
            <td class="achievement-${escapeHtml(achievement.className)}"><strong>${escapeHtml(achievement.label)}</strong></td>
          </tr>
        `;
      })
      .join("");
  }

  function buildActionPlanRows(context) {
    const critical = reportCriticalKpis(context.kpis, 8);
    if (!critical.length) {
      return `<tr><td colspan="6">Aucun KPI rouge ou orange a transformer en plan d'action.</td></tr>`;
    }
    return critical
      .map((kpi) => {
        const achievement = reportAchievement(kpi);
        return `
          <tr>
            <td>${escapeHtml(kpi.name)}</td>
            <td class="achievement-${escapeHtml(achievement.className)}"><strong>${escapeHtml(achievement.label)}</strong></td>
            <td>${escapeHtml(kpi.value || "--")}</td>
            <td>${escapeHtml(kpi.target || "--")}</td>
            <td>${escapeHtml(context.pole?.owner || kpi.poleOwner || "A affecter")}</td>
            <td>${escapeHtml(kpiAction(kpi))}</td>
          </tr>
        `;
      })
      .join("");
  }

  function reportDocumentHtml(context, mode = "pdf") {
    const title = `Rapport ${context.cycle.value} - ${context.pole.name}`;
    const criticalCount = reportCriticalKpis(context.kpis).length;
    const generatedAt = new Date().toLocaleString("fr-FR");
    return `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(title)}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #1f3864; margin: 28px; }
            h1 { margin: 0 0 6px; font-size: ${mode === "ppt" ? "34px" : "26px"}; }
            h2 { color: #1f3864; font-size: 18px; margin-top: 24px; }
            .meta { color: #555; margin-bottom: 18px; }
            .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
            .card { border: 1px solid #d9d9d9; border-left: 4px solid #d6a838; padding: 10px; }
            .card strong { display: block; font-size: 22px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th { background: #f2f2f2; color: #1f3864; text-align: left; }
            th, td { border: 1px solid #d9d9d9; padding: 8px; font-size: 12px; }
            .achievement-green { color: #107c41; font-weight: 700; }
            .achievement-amber { color: #c55a11; font-weight: 700; }
            .achievement-red { color: #c00000; font-weight: 700; }
            .achievement-gray { color: #666; font-weight: 700; }
            .comment { border-left: 4px solid #d6a838; background: #fffaf0; padding: 10px; margin-top: 16px; color: #333; }
            @media print { body { margin: 16mm; } button { display: none; } }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(title)}</h1>
          <p class="meta">Periode: ${escapeHtml(context.period)} | Responsable: ${escapeHtml(context.pole.owner)} | Genere le ${escapeHtml(generatedAt)}</p>
          <div class="summary">
            <div class="card"><span>Score</span><strong>${escapeHtml(context.pole.score ?? "--")}</strong></div>
            <div class="card"><span>KPI suivis</span><strong>${escapeHtml(context.kpis.length)}</strong></div>
            <div class="card"><span>KPI critiques</span><strong>${escapeHtml(criticalCount)}</strong></div>
            <div class="card"><span>Cycle</span><strong>${escapeHtml(context.cycle.value)}</strong></div>
          </div>
          <h2>Lecture KPI</h2>
          <table>
            <thead><tr><th>KPI</th><th>Valeur</th><th>Objectif</th><th>Tendance</th><th>Taux realise</th></tr></thead>
            <tbody>${buildReportTableRows(context.kpis)}</tbody>
          </table>
          <h2>Plan d'action KPI rouges/oranges</h2>
          <table>
            <thead><tr><th>KPI</th><th>Taux realise</th><th>Valeur</th><th>Objectif</th><th>Responsable</th><th>Action proposee</th></tr></thead>
            <tbody>${buildActionPlanRows(context)}</tbody>
          </table>
          <div class="comment"><strong>Commentaire responsable</strong><br>${escapeHtml(context.comment || "A completer par le responsable.")}</div>
        </body>
      </html>`;
  }

  function buildKpiCsv({ pole, cycle, period, kpis }) {
    const header = ["Pole", "Cycle", "Periode", "KPI", "Valeur", "Objectif", "Tendance", "Source Kobo", "Taux realise"];
    const rows = kpis.map((kpi) => [
      pole.name,
      cycle.value,
      period,
      kpi.name,
      kpi.value,
      kpi.target,
      kpi.trend,
      kpi.source,
      reportAchievement(kpi).label,
    ]);
    return [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\n");
  }

  function exportReportPdf(context, slug, options = {}) {
    const html = reportDocumentHtml(context, "pdf");
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      downloadTextFile(`rapport-${slug}-pdf.html`, html, "text/html;charset=utf-8");
      options.toast?.("Fenetre PDF bloquee. Un fichier HTML imprimable a ete telecharge.");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    options.toast?.("Rapport PDF ouvert. Choisissez 'Enregistrer en PDF' dans l'impression.");
  }

  function exportReportExcel(context, slug, options = {}) {
    const html = reportDocumentHtml(context, "excel");
    downloadTextFile(`rapport-${slug}.xls`, html, "application/vnd.ms-excel;charset=utf-8");
    options.toast?.("Export Excel genere.");
  }

  function exportReportPowerPoint(context, slug, options = {}) {
    try {
      downloadBlobFile(`rapport-${slug}.pptx`, buildPoleReportPptx(context));
      options.toast?.("Export PowerPoint executif .pptx genere.");
    } catch (error) {
      console.error(error);
      options.toast?.("Export PowerPoint impossible. Reessayez apres actualisation.");
    }
  }

  function exportManagementPowerPoint(context, slug, options = {}) {
    try {
      downloadBlobFile(`rapport-management-${slug}.pptx`, buildManagementReportPptx(context));
      options.toast?.("Rapport Management groupe PowerPoint genere.");
    } catch (error) {
      console.error(error);
      options.toast?.("Export Management impossible. Reessayez apres actualisation.");
    }
  }

  function exportJson(filename, payload, options = {}) {
    downloadTextFile(filename, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    options.toast?.("Export JSON du rapport genere.");
  }

  window.PMS_REPORTING = {
    buildKpiCsv,
    exportJson,
    exportManagementPowerPoint,
    exportReportExcel,
    exportReportPdf,
    exportReportPowerPoint,
    reportAchievement,
  };
})();

from __future__ import annotations

import argparse
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape


NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    "dc": "http://purl.org/dc/elements/1.1/",
    "dcterms": "http://purl.org/dc/terms/",
    "dcmitype": "http://purl.org/dc/dcmitype/",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
}


@dataclass
class InlineRun:
    text: str
    bold: bool = False
    code: bool = False


@dataclass
class Block:
    kind: str
    text: str
    level: int = 0


HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
ORDERED_RE = re.compile(r"^\d+\.\s+(.*)$")
UNORDERED_RE = re.compile(r"^[-*]\s+(.*)$")
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def parse_markdown(text: str) -> list[Block]:
    blocks: list[Block] = []
    paragraph: list[str] = []
    quote: list[str] = []
    code_lines: list[str] = []
    in_code = False

    def flush_paragraph() -> None:
        nonlocal paragraph
        if paragraph:
            blocks.append(Block("paragraph", " ".join(s.strip() for s in paragraph).strip()))
            paragraph = []

    def flush_quote() -> None:
        nonlocal quote
        if quote:
            blocks.append(Block("quote", " ".join(s.strip() for s in quote).strip()))
            quote = []

    def flush_code() -> None:
        nonlocal code_lines
        if code_lines:
            blocks.append(Block("code", "\n".join(code_lines).rstrip("\n")))
            code_lines = []

    for raw_line in text.splitlines():
        line = raw_line.rstrip("\n")
        stripped = line.strip()

        if in_code:
            if stripped.startswith("```"):
                flush_code()
                in_code = False
            else:
                code_lines.append(line)
            continue

        if stripped.startswith("```"):
            flush_paragraph()
            flush_quote()
            in_code = True
            code_lines = []
            continue

        heading = HEADING_RE.match(stripped)
        if heading:
            flush_paragraph()
            flush_quote()
            blocks.append(Block("heading", heading.group(2).strip(), len(heading.group(1))))
            continue

        if stripped == "---":
            flush_paragraph()
            flush_quote()
            blocks.append(Block("separator", ""))
            continue

        if not stripped:
            flush_paragraph()
            flush_quote()
            continue

        if stripped.startswith(">"):
            flush_paragraph()
            quote.append(stripped[1:].lstrip())
            continue

        ordered = ORDERED_RE.match(stripped)
        if ordered:
            flush_paragraph()
            flush_quote()
            blocks.append(Block("ordered", ordered.group(1).strip()))
            continue

        unordered = UNORDERED_RE.match(stripped)
        if unordered:
            flush_paragraph()
            flush_quote()
            blocks.append(Block("bullet", unordered.group(1).strip()))
            continue

        paragraph.append(line)

    flush_paragraph()
    flush_quote()
    flush_code()
    return blocks


def parse_inlines(text: str) -> list[InlineRun]:
    parts: list[InlineRun] = []
    i = 0
    while i < len(text):
        if text.startswith("**", i):
            j = text.find("**", i + 2)
            if j != -1:
                parts.append(InlineRun(text[i + 2 : j], bold=True))
                i = j + 2
                continue
        if text.startswith("`", i):
            j = text.find("`", i + 1)
            if j != -1:
                parts.append(InlineRun(text[i + 1 : j], code=True))
                i = j + 1
                continue
        if text.startswith("[", i):
            match = LINK_RE.match(text, i)
            if match:
                label, url = match.groups()
                parts.append(InlineRun(label))
                parts.append(InlineRun(f" ({url})", code=True))
                i = match.end()
                continue
        next_specials = [
            pos
            for pos in (text.find("**", i), text.find("`", i), text.find("[", i))
            if pos != -1
        ]
        next_pos = min(next_specials) if next_specials else len(text)
        parts.append(InlineRun(text[i:next_pos]))
        i = next_pos
    return [part for part in parts if part.text]


def run_xml(text: str, *, bold: bool = False, code: bool = False, preserve_space: bool = False) -> str:
    escaped = escape(text)
    attrs = ' xml:space="preserve"' if preserve_space or text.startswith(" ") or text.endswith(" ") else ""
    props = []
    if bold:
        props.append("<w:b/>")
    if code:
        props.append("<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\"/><w:sz w:val=\"20\"/>")
    prop_xml = f"<w:rPr>{''.join(props)}</w:rPr>" if props else ""
    return f"<w:r>{prop_xml}<w:t{attrs}>{escaped}</w:t></w:r>"


def inline_runs_xml(text: str) -> str:
    return "".join(
        run_xml(part.text, bold=part.bold, code=part.code)
        for part in parse_inlines(text)
    )


def code_runs_xml(text: str) -> str:
    lines = text.splitlines() or [""]
    runs: list[str] = []
    for idx, line in enumerate(lines):
        if idx:
            runs.append("<w:r><w:br/></w:r>")
        runs.append(run_xml(line if line else " ", code=True, preserve_space=True))
    return "".join(runs)


def paragraph_xml(
    runs_xml: str,
    *,
    style: str | None = None,
    num_id: int | None = None,
    spacing_before: int | None = None,
    spacing_after: int | None = None,
    keep_next: bool = False,
    page_break_before: bool = False,
    border_bottom: bool = False,
) -> str:
    props: list[str] = []
    if style:
        props.append(f"<w:pStyle w:val=\"{style}\"/>")
    if num_id is not None:
        props.append(
            f"<w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"{num_id}\"/></w:numPr>"
        )
    if spacing_before is not None or spacing_after is not None:
        before = spacing_before if spacing_before is not None else 0
        after = spacing_after if spacing_after is not None else 0
        props.append(f"<w:spacing w:before=\"{before}\" w:after=\"{after}\"/>")
    if keep_next:
        props.append("<w:keepNext/>")
    if page_break_before:
        props.append("<w:pageBreakBefore/>")
    if border_bottom:
        props.append(
            "<w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\" w:color=\"D9D9D9\"/></w:pBdr>"
        )
    prop_xml = f"<w:pPr>{''.join(props)}</w:pPr>" if props else ""
    return f"<w:p>{prop_xml}{runs_xml}</w:p>"


def build_document_xml(blocks: list[Block]) -> str:
    paragraphs: list[str] = []
    first_heading = True

    for block in blocks:
        if block.kind == "heading":
            if first_heading and block.level == 1:
                paragraphs.append(
                    paragraph_xml(
                        inline_runs_xml(block.text),
                        style="Title",
                        spacing_after=240,
                        keep_next=True,
                    )
                )
                first_heading = False
                continue
            style = {
                1: "Heading1",
                2: "Heading2",
                3: "Heading3",
            }.get(block.level, "Heading3")
            paragraphs.append(
                paragraph_xml(
                    inline_runs_xml(block.text),
                    style=style,
                    spacing_before=block.level == 1 and 240 or 120,
                    spacing_after=80,
                    keep_next=True,
                )
            )
        elif block.kind == "paragraph":
            paragraphs.append(
                paragraph_xml(inline_runs_xml(block.text), spacing_after=120)
            )
        elif block.kind == "bullet":
            paragraphs.append(
                paragraph_xml(inline_runs_xml(block.text), num_id=1, spacing_after=40)
            )
        elif block.kind == "ordered":
            paragraphs.append(
                paragraph_xml(inline_runs_xml(block.text), num_id=2, spacing_after=40)
            )
        elif block.kind == "quote":
            paragraphs.append(
                paragraph_xml(
                    inline_runs_xml(block.text),
                    style="BlockQuote",
                    spacing_after=120,
                )
            )
        elif block.kind == "code":
            paragraphs.append(
                paragraph_xml(code_runs_xml(block.text), style="CodeBlock", spacing_after=140)
            )
        elif block.kind == "separator":
            paragraphs.append(
                paragraph_xml("", spacing_after=120, border_bottom=True)
            )

    section = (
        "<w:sectPr>"
        "<w:pgSz w:w=\"12240\" w:h=\"15840\"/>"
        "<w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" "
        "w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/>"
        "</w:sectPr>"
    )

    body = "".join(paragraphs) + section
    return (
        f"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        f"<w:document xmlns:w=\"{NS['w']}\" xmlns:r=\"{NS['r']}\">"
        f"<w:body>{body}</w:body></w:document>"
    )


def styles_xml() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{NS['w']}">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/>
        <w:sz w:val="22"/>
        <w:lang w:val="en-US"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="120" w:line="276" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="32"/>
      <w:color w:val="1F2937"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="1F2937"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="180" w:after="60"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="243B53"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="140" w:after="40"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="22"/><w:color w:val="334E68"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="BlockQuote">
    <w:name w:val="Block Quote"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:left="720"/>
      <w:spacing w:before="60" w:after="120"/>
      <w:pBdr><w:left w:val="single" w:sz="16" w:space="12" w:color="9CA3AF"/></w:pBdr>
    </w:pPr>
    <w:rPr><w:i/><w:color w:val="4B5563"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="CodeBlock">
    <w:name w:val="Code Block"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="80" w:after="140"/>
      <w:ind w:left="360" w:right="120"/>
      <w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>
    </w:pPr>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr>
  </w:style>
</w:styles>
"""


def numbering_xml() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="{NS['w']}">
  <w:abstractNum w:abstractNumId="1">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="•"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="2">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>
"""


def content_types_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
"""


def package_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""


def document_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>
"""


def core_xml(title: str) -> str:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="{NS['cp']}" xmlns:dc="{NS['dc']}" xmlns:dcterms="{NS['dcterms']}" xmlns:dcmitype="{NS['dcmitype']}" xmlns:xsi="{NS['xsi']}">
  <dc:title>{escape(title)}</dc:title>
  <dc:creator>OpenAI Codex</dc:creator>
  <cp:lastModifiedBy>OpenAI Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>
"""


def app_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Office Word</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <Company></Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0000</AppVersion>
</Properties>
"""


def build_docx(source: Path, destination: Path) -> None:
    blocks = parse_markdown(source.read_text(encoding="utf-8"))
    title = next((block.text for block in blocks if block.kind == "heading"), source.stem)
    destination.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as docx:
        docx.writestr("[Content_Types].xml", content_types_xml())
        docx.writestr("_rels/.rels", package_rels_xml())
        docx.writestr("docProps/core.xml", core_xml(title))
        docx.writestr("docProps/app.xml", app_xml())
        docx.writestr("word/document.xml", build_document_xml(blocks))
        docx.writestr("word/styles.xml", styles_xml())
        docx.writestr("word/numbering.xml", numbering_xml())
        docx.writestr("word/_rels/document.xml.rels", document_rels_xml())


def main() -> None:
    parser = argparse.ArgumentParser(description="Export Markdown to a basic .docx file.")
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    build_docx(args.source, args.destination)
    print(f"Wrote {args.destination}")


if __name__ == "__main__":
    main()

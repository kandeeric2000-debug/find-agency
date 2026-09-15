import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  ExternalHyperlink,
  AlignmentType,
} from "docx";
import type { PageResult } from "@/lib/analysis";

export async function buildResultsDocx(pages: PageResult[]): Promise<Blob> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.LEFT,
      children: [new TextRun("Agency Competitor Research")],
    }),
  ];

  for (const page of pages) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [
          new TextRun(`Page: ${page.page.name || "(unnamed)"} — ${page.page.country}`),
        ],
      }),
    );
    if (page.page.rank) {
      children.push(new Paragraph({ children: [new TextRun(`Page Rank: #${page.page.rank}`)] }));
    }
    if (page.page.targetUrl) {
      children.push(new Paragraph({ children: [new TextRun(`URL: ${page.page.targetUrl}`)] }));
    }
    children.push(new Paragraph({ children: [new TextRun(`Country: ${page.page.country}`)] }));

    for (const k of page.keywords) {
      children.push(
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({ text: `${k.keyword} — KD ${k.kd ?? "??"}`, bold: true })],
        }),
      );

      if (k.error) {
        children.push(new Paragraph({ children: [new TextRun("Needs Review")] }));
        continue;
      }
      if (k.competitors.length === 0) {
        children.push(new Paragraph({ children: [new TextRun("No competitors")] }));
        continue;
      }
      for (const c of k.competitors) {
        children.push(
          new Paragraph({
            children: [
              new TextRun(`#${c.position}  `),
              new ExternalHyperlink({
                children: [new TextRun({ text: c.url, style: "Hyperlink" })],
                link: c.url,
              }),
            ],
          }),
        );
      }
      if (k.competitors.length === 1) {
        children.push(new Paragraph({ children: [new TextRun("No second competitor")] }));
      }
    }
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}

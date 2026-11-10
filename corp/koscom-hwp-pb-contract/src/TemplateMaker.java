import kr.dogfoot.hwplib.object.HWPFile;
import kr.dogfoot.hwplib.object.bodytext.Section;
import kr.dogfoot.hwplib.object.bodytext.control.Control;
import kr.dogfoot.hwplib.object.bodytext.control.ControlTable;
import kr.dogfoot.hwplib.object.bodytext.control.table.Cell;
import kr.dogfoot.hwplib.object.bodytext.control.table.Row;
import kr.dogfoot.hwplib.object.bodytext.paragraph.Paragraph;
import kr.dogfoot.hwplib.reader.HWPReader;
import kr.dogfoot.hwplib.writer.HWPWriter;

import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 실제 문서(.hwp) → 칸 토큰이 든 서식(.hwp). 서식을 처음 만들 때 한 번 쓴다.
 *
 *   java -cp "lib/hwplib-1.1.9.jar;scripts/koscom-hwp-fill.jar" TemplateMaker <원본.hwp> <바꿈표.tsv> <서식.hwp>
 *
 * 바꿈표(UTF-8, 탭 구분, #으로 시작하면 주석)
 *   L <찾을 글> <바꿀 글>          모든 문단(표 칸 포함)에서 글자 그대로 찾아 바꾼다. 위에서부터 차례로 적용
 *   C <문단 번호> <행> <열> <글>   그 문단에 든 표의 칸 글 전체를 바꾼다(첫 글자모양 유지)
 *
 * 고객사명·금액·사람 이름처럼 문서마다 바뀌는 글을 {{칸 이름}}으로 바꾼다. 원본과 바꿈표는 저장소에 넣지 않는다.
 * 글자모양이 바뀌는 자리에 걸친 글도 한 구간으로 합쳐 넣으므로, 토큰은 항상 한 글자모양 구간 안에 놓인다.
 */
public class TemplateMaker {
    static PrintStream out;

    public static void main(String[] a) throws Exception {
        out = new PrintStream(System.out, true, "UTF-8");
        if (a.length < 3) {
            out.println("usage: TemplateMaker <source.hwp> <map.tsv> <template.hwp>");
            System.exit(2);
        }
        HWPFile hwp = HWPReader.fromFile(a[0]);
        Section s = hwp.getBodyText().getSectionList().get(0);
        for (String line : Files.readAllLines(Paths.get(a[1]), StandardCharsets.UTF_8)) {
            if (line.startsWith("﻿")) line = line.substring(1);
            if (line.trim().isEmpty() || line.startsWith("#")) continue;
            String[] f = line.split("\t", -1);
            if (f[0].equals("L") && f.length >= 3) {
                int n = 0;
                for (int i = 0; i < s.getParagraphCount(); i++) n += replaceAll(s.getParagraph(i), f[1], f[2]);
                out.println((n > 0 ? "  " : "!! 못 찾음 ") + "L " + n + "곳 → " + f[2]);
            } else if (f[0].equals("C") && f.length >= 5) {
                ControlTable t = HwpOps.firstTable(s.getParagraph(Integer.parseInt(f[1])));
                Cell c = HwpOps.cell(t, Integer.parseInt(f[2]), Integer.parseInt(f[3]));
                Paragraph p = c.getParagraphList().getParagraph(0);
                List<HwpOps.Run> rs = HwpOps.getRuns(p);
                int cs = rs.isEmpty() ? (int) p.getCharShape().getPositonShapeIdPairList().get(0).getShapeId() : rs.get(0).cs;
                HwpOps.setText(p, f[4], cs);
                out.println("  C 문단" + f[1] + " 칸(" + f[2] + "," + f[3] + ") → " + f[4]);
            } else {
                out.println("!! 알 수 없는 줄: " + line);
            }
        }
        HWPWriter.toFile(hwp, a[2]);
        out.println("서식에 든 칸:");
        List<String> seen = new ArrayList<>();
        for (int i = 0; i < s.getParagraphCount(); i++) tokens(s.getParagraph(i), seen);
        for (String k : seen) out.println("  {{" + k + "}}");
        out.println("OK " + a[2]);
    }

    static int replaceAll(Paragraph p, String from, String to) throws Exception {
        int n = 0;
        if (p.getControlList() != null)
            for (Control c : p.getControlList())
                if (c instanceof ControlTable)
                    for (Row r : ((ControlTable) c).getRowList())
                        for (Cell cell : r.getCellList())
                            for (Paragraph cp : cell.getParagraphList()) n += replaceAll(cp, from, to);
        if (p.getText() == null) return n;
        List<HwpOps.Run> runs = HwpOps.getRuns(p);
        StringBuilder text = new StringBuilder();
        List<Integer> cs = new ArrayList<>();
        for (HwpOps.Run r : runs)
            for (char ch : r.text.toCharArray()) { text.append(ch); cs.add(r.cs); }
        int at = text.indexOf(from), hit = 0;
        while (at >= 0) {
            int shape = cs.get(at);                                   // 바꾼 글은 찾은 글의 첫 글자모양을 따른다
            text.replace(at, at + from.length(), to);
            for (int i = 0; i < from.length(); i++) cs.remove(at);
            for (int i = 0; i < to.length(); i++) cs.add(at, shape);
            hit++;
            at = text.indexOf(from, at + to.length());
        }
        if (hit == 0) return n;
        List<HwpOps.Run> outRuns = new ArrayList<>();
        int st = 0;
        for (int i = 1; i <= text.length(); i++)
            if (i == text.length() || !cs.get(i).equals(cs.get(st))) {
                outRuns.add(HwpOps.run(text.substring(st, i), cs.get(st)));
                st = i;
            }
        HwpOps.setRuns(p, outRuns);
        return n + hit;
    }

    static final Pattern TOKEN = Pattern.compile("\\{\\{([^{}]+)\\}\\}");

    static void tokens(Paragraph p, List<String> seen) {
        if (p.getControlList() != null)
            for (Control c : p.getControlList())
                if (c instanceof ControlTable)
                    for (Row r : ((ControlTable) c).getRowList())
                        for (Cell cell : r.getCellList())
                            for (Paragraph cp : cell.getParagraphList()) tokens(cp, seen);
        Matcher m = TOKEN.matcher(HwpOps.plainText(p));
        while (m.find()) if (!seen.contains(m.group(1))) seen.add(m.group(1));
    }
}

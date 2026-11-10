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
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 서식 채우기: 칸 토큰({{이름}})이 든 서식 .hwp에 값을 넣어 같은 모양의 .hwp를 만든다.
 *
 *   java -cp "lib/hwplib-1.1.9.jar;scripts/koscom-hwp-fill.jar" FillRenderer <서식.hwp> <values.json> <결과.hwp>
 *
 * values.json
 *   { "fields": { "고객사명": "E증권 주식회사", ... },
 *     "rows":   { "이용료": [ { "대분류": "영업지원", "회사기본": "18,000", ... }, ... ] } }
 *
 * - {{이름}}            : fields의 값으로 바꾼다. 이름이 아예 없으면 비우고 WARN을 낸다(""는 일부러 비운 칸).
 * - {{표이름.열이름}}   : 이 토큰이 든 표의 행을 rows[표이름]의 건수만큼 복제해 채운다(0건이면 빈 행 1개).
 * - 글꼴·문단 모양·표 테두리·쪽 구성은 서식 그대로다. 바꾼 문단은 줄 배치 정보를 지워 한글이 다시 계산하게 한다.
 *
 * 표준출력: WARN … / OK <경로> / ERROR …(종료 코드 1)
 */
public class FillRenderer {
    static final Pattern TOKEN = Pattern.compile("\\{\\{([^{}]+)\\}\\}");
    static PrintStream out;
    static final Set<String> missing = new LinkedHashSet<>();
    static final Set<String> used = new LinkedHashSet<>();
    static final List<String> warns = new ArrayList<>();

    public static void main(String[] a) throws Exception {
        out = new PrintStream(System.out, true, "UTF-8");
        if (a.length < 3) {
            out.println("usage: FillRenderer <template.hwp> <values.json> <out.hwp>");
            System.exit(2);
        }
        try {
            Object root = Json.parse(new String(Files.readAllBytes(Paths.get(a[1])), "UTF-8"));
            if (!(root instanceof Map)) throw new IllegalArgumentException("values.json은 객체여야 함");
            Map<String, String> fields = strMap(((Map<?, ?>) root).get("fields"));
            Map<String, List<Map<String, String>>> rows = rowsMap(((Map<?, ?>) root).get("rows"));

            HWPFile hwp = HWPReader.fromFile(a[0]);
            for (Section s : hwp.getBodyText().getSectionList())
                for (int i = 0; i < s.getParagraphCount(); i++) walk(s.getParagraph(i), fields, rows);
            HWPWriter.toFile(hwp, a[2]);

            for (String k : missing) warns.add("[칸] 값이 없어 비워 둠: " + k);
            for (String k : fields.keySet()) if (!used.contains(k)) warns.add("[칸] 서식에 없는 이름: " + k);
            for (String k : rows.keySet()) if (!used.contains(k + ".")) warns.add("[표] 서식에 없는 표: " + k);
            for (String w : warns) out.println("WARN " + w);
            out.println("OK " + a[2]);
        } catch (Exception e) {
            out.println("ERROR " + e);
            System.exit(1);
        }
    }

    /** 문단과 그 안의 표 칸을 따라 내려가며 토큰을 채운다. */
    static void walk(Paragraph p, Map<String, String> fields, Map<String, List<Map<String, String>>> rows) throws Exception {
        if (p.getControlList() != null)
            for (Control c : p.getControlList())
                if (c instanceof ControlTable) {
                    ControlTable t = (ControlTable) c;
                    expandRows(t, rows);
                    for (Row r : t.getRowList())
                        for (Cell cell : r.getCellList())
                            for (Paragraph cp : cell.getParagraphList()) walk(cp, fields, rows);
                }
        fill(p, fields, null);
    }

    /** {{표.열}} 토큰이 든 행을 자료 건수만큼 복제해 채우고, 표의 행 수·행 번호·높이를 맞춘다. */
    static void expandRows(ControlTable t, Map<String, List<Map<String, String>>> rows) throws Exception {
        List<Row> list = t.getRowList();
        for (int ri = 0; ri < list.size(); ri++) {
            Row row = list.get(ri);
            String key = tableKey(row);
            if (key == null) continue;
            used.add(key + ".");
            List<Map<String, String>> data = rows.get(key);
            if (data == null || data.isEmpty()) {
                warns.add("[표] 자료가 없어 빈 행 1개로 둠: " + key);
                data = new ArrayList<>();
                data.add(new LinkedHashMap<String, String>());
            }
            int n = data.size(), added = n - 1;
            long rowH = 0;
            for (Cell c : row.getCellList())
                if (c.getListHeader().getRowSpan() == 1) rowH = Math.max(rowH, c.getListHeader().getHeight());
            List<Row> made = new ArrayList<>();
            for (int k = 1; k < n; k++) made.add(row.clone());      // 채우기 전에 토큰이 든 원형을 복제해 둔다
            made.add(0, row);
            for (int k = 0; k < n; k++) {
                for (Cell c : made.get(k).getCellList()) {
                    c.getListHeader().setRowIndex(ri + k);
                    for (Paragraph cp : c.getParagraphList()) fill(cp, data.get(k), key + ".");
                }
            }
            if (added > 0) {
                // 위쪽 행에서 이 행까지 내려오는 병합 칸은 늘리고, 아래쪽 행은 번호를 민다
                for (int j = 0; j < list.size(); j++) {
                    if (j == ri) continue;
                    for (Cell c : list.get(j).getCellList()) {
                        int top = c.getListHeader().getRowIndex(), span = c.getListHeader().getRowSpan();
                        if (j < ri && top + span - 1 >= ri) c.getListHeader().setRowSpan(span + added);
                        if (j > ri) c.getListHeader().setRowIndex(top + added);
                    }
                }
                list.addAll(ri + 1, made.subList(1, n));
                t.getTable().setRowCount(list.size());
                t.getTable().getCellCountOfRowList().clear();
                for (Row r : list) t.getTable().addCellCountOfRow(r.getCellList().size());
                t.getHeader().setHeight(t.getHeader().getHeight() + rowH * added);
            }
            ri += added;
        }
    }

    static String tableKey(Row row) {
        for (Cell c : row.getCellList())
            for (Paragraph cp : c.getParagraphList()) {
                Matcher m = TOKEN.matcher(HwpOps.plainText(cp));
                while (m.find()) {
                    String k = m.group(1).trim();
                    int dot = k.indexOf('.');
                    if (dot > 0) return k.substring(0, dot);
                }
            }
        return null;
    }

    /**
     * 문단의 토큰을 값으로 바꾼다. prefix가 있으면 그 표의 열 토큰({{표.열}})만, 없으면 일반 칸만 본다.
     * 글자모양 구간은 그대로 둔다(토큰은 한 구간 안에 있어야 한다 — TemplateMaker가 그렇게 만든다).
     */
    static void fill(Paragraph p, Map<String, String> values, String prefix) throws Exception {
        if (p.getText() == null) return;
        List<HwpOps.Run> runs = HwpOps.getRuns(p);
        boolean changed = false;
        List<HwpOps.Run> outRuns = new ArrayList<>();
        for (HwpOps.Run r : runs) {
            Matcher m = TOKEN.matcher(r.text);
            StringBuffer sb = new StringBuffer();
            while (m.find()) {
                String k = m.group(1).trim();
                boolean col = k.indexOf('.') > 0;
                if (prefix == null ? col : !k.startsWith(prefix)) continue;     // 다른 단계에서 채울 토큰
                String name = prefix == null ? k : k.substring(prefix.length());
                String v = values.get(name);
                if (prefix == null) used.add(name);
                if (v == null) {                       // 값이 아예 없으면 알린다. 빈 문자열("")은 일부러 비운 칸으로 본다
                    if (prefix == null) missing.add(name);
                    v = "";
                }
                m.appendReplacement(sb, Matcher.quoteReplacement(v.replaceAll("[\\r\\n]+", " ")));
                changed = true;
            }
            m.appendTail(sb);
            outRuns.add(HwpOps.run(sb.toString(), r.cs));
        }
        if (changed) HwpOps.setRuns(p, outRuns);
    }

    static Map<String, String> strMap(Object o) {
        Map<String, String> m = new LinkedHashMap<>();
        if (o instanceof Map)
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet())
                m.put(String.valueOf(e.getKey()).trim(), str(e.getValue()));
        return m;
    }

    static Map<String, List<Map<String, String>>> rowsMap(Object o) {
        Map<String, List<Map<String, String>>> m = new LinkedHashMap<>();
        if (o instanceof Map)
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
                List<Map<String, String>> l = new ArrayList<>();
                if (e.getValue() instanceof List)
                    for (Object r : (List<?>) e.getValue()) l.add(strMap(r));
                m.put(String.valueOf(e.getKey()).trim(), l);
            }
        return m;
    }

    static String str(Object v) {
        if (v == null) return "";
        if (v instanceof Double) {
            double d = (Double) v;
            return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
        }
        return String.valueOf(v);
    }
}

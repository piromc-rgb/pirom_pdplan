import os
import sys
import zipfile
import json
import xml.etree.ElementTree as ET

def sync_plan_materials(target_filename="LN Status Overview.xlsx"):
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    gdrive_dir = "/Users/pirom/Library/CloudStorage/GoogleDrive-pirom.c@gmail.com/My Drive/staus overview"
    
    gdrive_path = os.path.join(gdrive_dir, target_filename)
    if not os.path.exists(gdrive_path):
        fallback_g = os.path.join(gdrive_dir, "LN Status Overview.xlsx")
        if os.path.exists(fallback_g):
            gdrive_path = fallback_g

    local_xlsx = os.path.join(base_dir, target_filename)
    if not os.path.exists(local_xlsx):
        fallback_l = os.path.join(base_dir, "LN Status Overview.xlsx")
        if os.path.exists(fallback_l):
            local_xlsx = fallback_l

    cache_json = os.path.join(base_dir, "plan_materials_cache.json")

    # If Google Drive file exists and is newer or local is missing, copy it over
    if os.path.exists(gdrive_path):
        try:
            target_local = os.path.join(base_dir, os.path.basename(gdrive_path))
            if not os.path.exists(target_local) or os.path.getmtime(gdrive_path) > os.path.getmtime(target_local):
                import shutil
                shutil.copy2(gdrive_path, target_local)
                local_xlsx = target_local
                print(f"Updated {local_xlsx} from Google Drive")
        except Exception as e:
            print(f"Warning: could not sync from Google Drive: {e}")

    source_xlsx = local_xlsx if os.path.exists(local_xlsx) else gdrive_path
    if not os.path.exists(source_xlsx):
        print(f"Error: {source_xlsx} not found")
        return False

    print(f"Reading from {source_xlsx}...")
    with zipfile.ZipFile(source_xlsx, "r") as z:
        shared_tree = ET.fromstring(z.read("xl/sharedStrings.xml"))
        ns = {"ns": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        strings = []
        for si in shared_tree.findall("ns:si", ns):
            t = si.find("ns:t", ns)
            if t is not None and t.text:
                strings.append(t.text)
            else:
                strings.append("".join([node.text for node in si.findall(".//ns:t", ns) if node.text]))

        def parse_sheet(sheet_path):
            tree = ET.fromstring(z.read(sheet_path))
            rows = tree.findall(".//ns:row", ns)
            data = []
            for r in rows:
                cols = {}
                for c in r.findall("ns:c", ns):
                    ref = c.attrib.get("r", "")
                    col_letter = "".join([ch for ch in ref if ch.isalpha()])
                    t = c.attrib.get("t")
                    v = c.find("ns:v", ns)
                    val = ""
                    if v is not None and v.text:
                        if t == "s":
                            idx = int(v.text)
                            val = strings[idx] if idx < len(strings) else ""
                        else:
                            val = v.text
                    cols[col_letter] = val
                data.append(cols)
            return data

        # Sheet 8 (Plan + Mat)
        sheet8_data = parse_sheet("xl/worksheets/sheet8.xml")
        plan_materials = {}
        for row in sheet8_data[1:]:
            pd_id = (row.get("F") or "").strip()
            if not pd_id or not pd_id.startswith("PD"):
                continue
            
            step_raw = row.get("J", "0")
            try:
                step_num = int(float(step_raw))
            except:
                step_num = 10
                
            wc = (row.get("K") or "").strip()
            oper_desc = (row.get("L") or "").strip()
            mat = (row.get("O") or "").strip()
            mat_desc = (row.get("P") or "").strip()
            
            qty_raw = row.get("S", "0")
            try:
                est_qty = float(qty_raw)
            except:
                est_qty = 0.0

            actual_raw = row.get("T", "0")
            try:
                actual_qty = float(actual_raw)
            except:
                actual_qty = 0.0

            to_issue_wh_raw = row.get("U", "0")
            try:
                to_issue_wh = float(to_issue_wh_raw)
            except:
                to_issue_wh = 0.0

            to_issue_raw = row.get("V", "0")
            try:
                to_issue = float(to_issue_raw)
            except:
                to_issue = 0.0

            oper_status = (row.get("W") or "").strip()
            order_status = (row.get("X") or "").strip()

            if pd_id not in plan_materials:
                plan_materials[pd_id] = []

            exists = any(m["stepNum"] == step_num and m["mat"] == mat for m in plan_materials[pd_id])
            if not exists:
                plan_materials[pd_id].append({
                    "stepNum": step_num,
                    "wc": wc,
                    "operDesc": oper_desc,
                    "mat": mat,
                    "matDesc": mat_desc,
                    "estimatedQty": est_qty,
                    "actualQty": actual_qty,
                    "toIssueWh": to_issue_wh,
                    "toIssue": to_issue,
                    "operStatus": oper_status,
                    "orderStatus": order_status
                })

        # Sheet 5 (Data)
        sheet5_data = parse_sheet("xl/worksheets/sheet5.xml")
        dwg_to_pd_map = {}
        for row in sheet5_data[1:]:
            pd_id = (row.get("G") or "").strip()
            dwg = (row.get("K") or "").strip()
            if not pd_id or not dwg:
                continue
                
            step_raw = row.get("M", "0")
            try:
                step_num = int(float(step_raw))
            except:
                step_num = 10
                
            mc = (row.get("N") or "").strip()
            op_name = (row.get("O") or "").strip()
            op_status = (row.get("P") or "Planned").strip()
            order_status = (row.get("R") or "Active").strip()
            project = (row.get("E") or "").strip()

            if dwg not in dwg_to_pd_map:
                dwg_to_pd_map[dwg] = {
                    "pdId": pd_id,
                    "project": project,
                    "orderStatus": order_status,
                    "operations": []
                }
            else:
                curr = dwg_to_pd_map[dwg]
                if curr["pdId"] != pd_id:
                    if curr["orderStatus"].lower() == "closed" and order_status.lower() != "closed":
                        dwg_to_pd_map[dwg] = {
                            "pdId": pd_id,
                            "project": project,
                            "orderStatus": order_status,
                            "operations": []
                        }
                    elif pd_id > curr["pdId"] and (curr["orderStatus"].lower() == order_status.lower()):
                        dwg_to_pd_map[dwg] = {
                            "pdId": pd_id,
                            "project": project,
                            "orderStatus": order_status,
                            "operations": []
                        }

            target = dwg_to_pd_map[dwg]
            if target["pdId"] == pd_id:
                op_exists = any(op["stepNum"] == step_num for op in target["operations"])
                if not op_exists:
                    target["operations"].append({
                        "stepNum": step_num,
                        "name": op_name,
                        "machine": mc,
                        "status": op_status
                    })

        output_obj = {
            "planMaterials": plan_materials,
            "dwgToPdMap": dwg_to_pd_map
        }
        with open(cache_json, "w", encoding="utf-8") as out:
            json.dump(output_obj, out, ensure_ascii=False)
        print(f"Successfully generated {cache_json} with {len(plan_materials)} PDs and {len(dwg_to_pd_map)} DWGs.")

        public_cache = os.path.join(base_dir, "public", "plan_materials_cache.json")
        try:
            import shutil
            shutil.copy2(cache_json, public_cache)
            print(f"Copied cache to {public_cache}")
        except Exception as e:
            print(f"Warning: could not copy to public: {e}")

        dist_cache = os.path.join(base_dir, "dist", "plan_materials_cache.json")
        if os.path.exists(os.path.join(base_dir, "dist")):
            try:
                import shutil
                shutil.copy2(cache_json, dist_cache)
                print(f"Copied cache to {dist_cache}")
            except Exception as e:
                print(f"Warning: could not copy to dist: {e}")

        if os.path.exists(gdrive_dir):
            try:
                import shutil
                gdrive_cache = os.path.join(gdrive_dir, "plan_materials_cache.json")
                shutil.copy2(cache_json, gdrive_cache)
                print(f"Copied cache to Google Drive: {gdrive_cache}")
            except Exception as e:
                print(f"Warning: could not copy to Google Drive: {e}")

        return True

if __name__ == "__main__":
    fn = sys.argv[1] if len(sys.argv) > 1 else "LN Status Overview.xlsx"
    sync_plan_materials(fn)

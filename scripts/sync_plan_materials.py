import os
import sys
import glob
import shutil
import tempfile
import zipfile
import json
import xml.etree.ElementTree as ET


def find_gdrive_dir():
    home = os.path.expanduser("~")
    candidates = [
        r"G:\My Drive\staus overview",
        r"G:\My Drive\status overview",
        r"G:\ไดรฟ์ของฉัน\staus overview",
        r"G:\ไดรฟ์ของฉัน\status overview",
        r"H:\My Drive\staus overview",
        r"H:\My Drive\status overview",
        os.path.join(home, "Google Drive", "My Drive", "staus overview"),
        os.path.join(home, "Google Drive", "My Drive", "status overview"),
        "/Users/pirom/Library/CloudStorage/GoogleDrive-pirom.c@gmail.com/My Drive/staus overview",
        "/Users/pirom/Library/CloudStorage/GoogleDrive-pirom.c@gmail.com/My Drive/status overview",
        "/Volumes/GoogleDrive/My Drive/staus overview",
        "/Volumes/GoogleDrive/My Drive/status overview",
    ]
    # Dynamically scan macOS ~/Library/CloudStorage/GoogleDrive-*
    cloud_storage = os.path.join(home, "Library", "CloudStorage")
    if os.path.isdir(cloud_storage):
        for gd_root in glob.glob(os.path.join(cloud_storage, "GoogleDrive*")):
            for drive_sub in ("My Drive", "ไดรฟ์ของฉัน"):
                for folder_name in ("staus overview", "status overview"):
                    candidates.append(os.path.join(gd_root, drive_sub, folder_name))

    for d in candidates:
        if d and os.path.isdir(d):
            return d
    return candidates[0]


def get_temp_cache_path():
    temp_dir = os.path.join(tempfile.gettempdir(), "pirom_pdplan")
    os.makedirs(temp_dir, exist_ok=True)
    return os.path.join(temp_dir, "plan_materials_cache.json")


def sync_plan_materials(target_filename="LN Status Overview.xlsx"):
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    gdrive_dir = find_gdrive_dir()

    gdrive_path = os.path.join(gdrive_dir, target_filename)
    if not os.path.exists(gdrive_path):
        fallback_g = os.path.join(gdrive_dir, "LN Status Overview.xlsx")
        if os.path.exists(fallback_g):
            gdrive_path = fallback_g

    temp_dir = os.path.join(tempfile.gettempdir(), "pirom_pdplan")
    os.makedirs(temp_dir, exist_ok=True)
    temp_xlsx = os.path.join(temp_dir, os.path.basename(target_filename))

    local_xlsx = os.path.join(base_dir, target_filename)
    if not os.path.exists(local_xlsx):
        fallback_l = os.path.join(base_dir, "LN Status Overview.xlsx")
        if os.path.exists(fallback_l):
            local_xlsx = fallback_l

    cache_json = os.path.join(base_dir, "plan_materials_cache.json")
    temp_cache_json = get_temp_cache_path()

    # If Google Drive file exists and is newer or local is missing, copy it to local/temp
    if os.path.exists(gdrive_path):
        try:
            target_local = os.path.join(base_dir, os.path.basename(gdrive_path))
            if not os.path.exists(target_local) or os.path.getmtime(gdrive_path) > os.path.getmtime(target_local):
                shutil.copy2(gdrive_path, target_local)
                local_xlsx = target_local
                print(f"Updated {local_xlsx} from Google Drive")
        except Exception as e:
            print(f"Warning: could not sync from Google Drive: {e}")

    source_xlsx = local_xlsx if os.path.exists(local_xlsx) else (temp_xlsx if os.path.exists(temp_xlsx) else gdrive_path)
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
        pd_op_status_map = {}
        for row in sheet5_data[1:]:
            pd_id = (row.get("G") or "").strip()
            dwg = (row.get("K") or "").strip()
            if not pd_id:
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

            if op_status:
                pd_entry = pd_op_status_map.setdefault(pd_id, {})
                pd_entry[str(step_num)] = op_status
                if mc:
                    prev_mc_status = pd_entry.get(mc, "")
                    if not prev_mc_status or prev_mc_status.lower() == "completed":
                        pd_entry[mc] = op_status

            if not dwg:
                continue

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

        # Ensure any operation status from Sheet 8 (Plan + Mat) is also in pd_op_status_map
        for pd_id, mat_list in plan_materials.items():
            pd_entry = pd_op_status_map.setdefault(pd_id, {})
            for m in mat_list:
                st = (m.get("operStatus") or "").strip()
                if not st:
                    continue
                s_key = str(m.get("stepNum") or 10)
                if s_key not in pd_entry:
                    pd_entry[s_key] = st
                wc = (m.get("wc") or "").strip()
                if wc and wc not in pd_entry:
                    pd_entry[wc] = st

        output_obj = {
            "planMaterials": plan_materials,
            "dwgToPdMap": dwg_to_pd_map,
            "pdOpStatusMap": pd_op_status_map
        }
        # 1. Write to OS Temp Local Disk (fastest local I/O, no cloud sync overhead)
        try:
            with open(temp_cache_json, "w", encoding="utf-8") as out_tmp:
                json.dump(output_obj, out_tmp, ensure_ascii=False)
            print(f"Saved Temp Local Disk cache: {temp_cache_json}")
        except Exception as e:
            print(f"Warning: could not write temp cache {temp_cache_json}: {e}")

        # 2. Write to local workspace for static/dev serving
        with open(cache_json, "w", encoding="utf-8") as out:
            json.dump(output_obj, out, ensure_ascii=False)
        print(f"Successfully generated {cache_json} with {len(plan_materials)} PDs, {len(dwg_to_pd_map)} DWGs, and {len(pd_op_status_map)} PD op statuses.")

        # Also enrich Plan.json scheduledJobs and workOrders with opStatus if Plan.json exists
        plan_json_path = os.path.join(base_dir, "Plan.json")
        if os.path.exists(plan_json_path):
            try:
                with open(plan_json_path, "r", encoding="utf-8") as pf:
                    plan_data = json.load(pf)
                changed = False
                for job in plan_data.get("scheduledJobs", []):
                    wo_id = job.get("woId") or job.get("id")
                    pd_ops = pd_op_status_map.get(wo_id)
                    if pd_ops:
                        s_key = str(job.get("stepNum") or 10)
                        mc = (job.get("machine") or "").strip()
                        op_st = pd_ops.get(s_key) or (pd_ops.get(mc) if mc else None)
                        if op_st and job.get("opStatus") != op_st:
                            job["opStatus"] = op_st
                            changed = True
                for wo in plan_data.get("workOrders", []):
                    wo_id = wo.get("id")
                    pd_ops = pd_op_status_map.get(wo_id)
                    if pd_ops:
                        for step in wo.get("steps", []):
                            s_key = str(step.get("stepNum") or 10)
                            mc = (step.get("machine") or "").strip()
                            op_st = pd_ops.get(s_key) or (pd_ops.get(mc) if mc else None)
                            if op_st and step.get("opStatus") != op_st:
                                step["opStatus"] = op_st
                                changed = True
                if changed:
                    with open(plan_json_path, "w", encoding="utf-8") as pf:
                        json.dump(plan_data, pf, ensure_ascii=False, indent=2)
                    print(f"Updated opStatus in {plan_json_path}")
            except Exception as e:
                print(f"Warning: could not update Plan.json opStatus: {e}")

        public_cache = os.path.join(base_dir, "public", "plan_materials_cache.json")
        try:
            shutil.copy2(cache_json, public_cache)
            print(f"Copied cache to {public_cache}")
        except Exception as e:
            print(f"Warning: could not copy to public: {e}")

        dist_cache = os.path.join(base_dir, "dist", "plan_materials_cache.json")
        if os.path.exists(os.path.join(base_dir, "dist")):
            try:
                shutil.copy2(cache_json, dist_cache)
                print(f"Copied cache to {dist_cache}")
            except Exception as e:
                print(f"Warning: could not copy to dist: {e}")

        return True

if __name__ == "__main__":
    fn = sys.argv[1] if len(sys.argv) > 1 else "LN Status Overview.xlsx"
    sync_plan_materials(fn)

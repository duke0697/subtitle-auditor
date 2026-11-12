from app.asr import resolve_device


def test_cpu_mode_ignores_gpu():
    assert resolve_device("cpu", True, "") == ("cpu", None)


def test_auto_uses_gpu_when_available():
    assert resolve_device("auto", True, "") == ("cuda", None)


def test_auto_falls_back_silently():
    assert resolve_device("auto", False, "未安装 GPU 加速组件") == ("cpu", None)


def test_forced_gpu_reports_reason():
    device, error = resolve_device("cuda", False, "未安装 GPU 加速组件")
    assert device == "cpu"
    assert error is not None
    assert "GPU 不可用" in error
    assert "GPU 组件" in error


def test_prompt_from_glossary():
    from app.asr import build_prompt

    prompt = build_prompt(["高压互锁", "CAN通讯", "高压互锁", "  "])
    assert prompt == "以下是普通话讲解，涉及高压互锁、CAN通讯等术语。"


def test_prompt_without_glossary_only_biases_simplified():
    from app.asr import build_prompt

    assert build_prompt([]) == "以下是普通话的句子。"
    assert build_prompt(None) == "以下是普通话的句子。"


def test_prompt_is_capped():
    from app.asr import build_prompt

    prompt = build_prompt([f"术语{index:02d}" for index in range(60)])
    assert prompt.startswith("以下是普通话讲解")
    assert prompt.endswith("等术语。")
    assert len(prompt) <= 180


def test_prompt_prefers_terms_present_in_subtitle():
    from app.asr import build_prompt

    prompt = build_prompt(
        ["曲柄连杆机构", "高压互锁", "绝缘检测", "配气机构", "电池包"],
        "下面检查高压互锁线路，先做绝缘检测，再看电池包",
    )
    assert "高压互锁" in prompt
    assert prompt.index("高压互锁") < prompt.index("曲柄连杆机构")


def test_prompt_keeps_relevant_term_when_glossary_exceeds_budget():
    from app.asr import build_prompt

    glossary = [f"术语甲{index:02d}" for index in range(40)] + ["高压互锁"]
    assert "高压互锁" in build_prompt(glossary, "讲解高压互锁")

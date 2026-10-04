import unittest

from src.manual_repairs import RepairError, apply_repairs


def article(uid="a1", **kwargs):
    return {
        "uid": uid,
        "title": "Korean source headline",
        "title_en": "Korean source headline",
        "summary": "원문 요약",
        "source_excerpt": "원문 요약",
        "date": "2026-09-01",
        **kwargs,
    }


class ManualRepairTests(unittest.TestCase):
    def test_translates_title_without_touching_original_or_other_fields(self):
        original = article()
        updated, changed = apply_repairs([original], [{
            "uid": "a1", "title": "中文標題",
        }])

        self.assertEqual(changed, 1)
        self.assertEqual(updated[0]["title"], "中文標題")
        self.assertEqual(updated[0]["title_en"], original["title_en"])
        self.assertEqual(updated[0]["summary"], original["summary"])
        self.assertEqual(original["title"], "Korean source headline")

    def test_fills_blank_summary_only_with_a_source_excerpt(self):
        updated, changed = apply_repairs(
            [article(summary="", source_excerpt="")],
            [{"uid": "a1", "title": "中文標題", "summary": "有來源的摘要",
              "source_excerpt": "Verified source wording"}],
        )

        self.assertEqual(changed, 3)
        self.assertEqual(updated[0]["summary"], "有來源的摘要")
        self.assertEqual(updated[0]["source_excerpt"], "Verified source wording")

    def test_does_not_replace_an_existing_chinese_summary(self):
        with self.assertRaises(RepairError):
            apply_repairs(
                [article(summary="原有中文摘要")],
                [{"uid": "a1", "title": "中文標題", "summary": "另一段摘要"}],
            )

    def test_can_translate_a_korean_summary_that_contains_one_hanja(self):
        updated, changed = apply_repairs(
            [article(summary="보험 안내 前 사전심사")],
            [{"uid": "a1", "title": "中文標題", "summary": "保險事前審查資訊"}],
        )

        self.assertEqual(changed, 2)
        self.assertEqual(updated[0]["summary"], "保險事前審查資訊")

    def test_rejects_duplicate_and_unknown_uids(self):
        with self.assertRaises(RepairError):
            apply_repairs([article()], [
                {"uid": "a1", "title": "中文標題"},
                {"uid": "a1", "title": "另一個中文標題"},
            ])
        with self.assertRaises(RepairError):
            apply_repairs([article()], [{"uid": "missing", "title": "中文標題"}])

    def test_rejects_overwriting_source_excerpt_and_unknown_fields(self):
        with self.assertRaises(RepairError):
            apply_repairs([article()], [{
                "uid": "a1", "title": "中文標題", "source_excerpt": "改寫的原文",
            }])
        with self.assertRaises(RepairError):
            apply_repairs([article()], [{
                "uid": "a1", "title": "中文標題", "filter": "irrelevant",
            }])

    def test_is_idempotent_for_already_applied_repairs(self):
        fixed = article(title="中文標題", summary="中文摘要",
                        source_excerpt="Verified source wording")
        updated, changed = apply_repairs([fixed], [{
            "uid": "a1", "title": "中文標題", "summary": "中文摘要",
            "source_excerpt": "Verified source wording",
        }])

        self.assertEqual(changed, 0)
        self.assertEqual(updated, [fixed])


if __name__ == "__main__":
    unittest.main()

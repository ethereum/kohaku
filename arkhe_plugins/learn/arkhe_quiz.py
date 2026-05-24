import random, json, hashlib, time

class QuizEngine:
    def __init__(self, user_npub):
        self.user = user_npub
        self.score = {}

    def generate_question(self, topic):
        return {
            "topic": topic,
            "question": f"Explain the key concept of {topic}.",
            "rubric": ["accuracy", "clarity", "depth"]
        }

    def grade_answer(self, question, answer):
        return random.randint(0, 100)

    def run_pillar_exam(self, pillar_name):
        topics = []
        results = {}
        for t in topics:
            q = self.generate_question(t)
            answer = f"Simulated answer for {t}"
            results[t] = self.grade_answer(q, answer)
        self.score[pillar_name] = [results[t] for t in topics]
        if not self.score[pillar_name]: return 0
        avg = sum(self.score[pillar_name]) / len(self.score[pillar_name])
        return avg

    def is_certified(self):
        return all(sum(scores)/len(scores) >= 80 for scores in self.score.values() if scores)

    def issue_badge(self):
        badge = {
            "user_npub": self.user,
            "curriculum": "612-LLM-FOUNDATIONS",
            "completed_at": int(time.time()),
            "pillar_scores": {p: sum(s)/len(s) for p, s in self.score.items() if s},
        }
        badge_json = json.dumps(badge, sort_keys=True)
        badge["seal"] = hashlib.sha256(badge_json.encode()).hexdigest()
        return badge

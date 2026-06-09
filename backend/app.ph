# app.py
import os
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

GROQ_API_KEY = os.environ.get('GROQ_API_KEY')
GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
MODEL = 'llama3-70b-8192'  # or 'mixtral-8x7b-32768'

# =============================
# TOOL-SPECIFIC SYSTEM PROMPTS
# =============================
SYSTEM_PROMPTS = {
    'chat': 'You are a helpful AI assistant. Answer questions clearly and concisely.',
    
    'code-bug-finder': """You are an expert code debugger. Analyze the provided code snippet, identify bugs, explain why they are bugs, and provide the corrected code. 

Format your response as follows:
1. **Bug Summary** – Brief description of the issue(s)
2. **Line-by-Line Explanation** – Explain each bug
3. **Fixed Code** – Provide the corrected code block
4. **How to Avoid** – Tips to prevent this in the future""",

    'email-reply': """You are a professional email assistant. Given an email (or a description of the email), generate a polite, professional reply. 

If the user provides a subject line and recipient name, use them. Otherwise, keep it generic. 
Keep your reply concise (2-3 sentences max) and respectful.""",

    'homework-helper': """You are a helpful homework assistant. Answer the student's question clearly and accurately. 
If it's a math problem, show step-by-step work. If it's a science question, explain the concept simply. 
If it's an essay or writing assignment, provide a clear outline with key points.""",

    'resume-builder': """You are a professional resume writer. Based on the user's input (job title, skills, experience, education), create a professional resume section. 

Format as follows:
**Professional Summary** – 2-3 sentence summary
**Skills** – Bulleted list of key skills
**Work Experience** – (if provided) Format with job title, company, dates, and 2-3 bullet points
**Education** – (if provided) Degree, school, graduation year
**Optional:** Add a "Certifications" or "Projects" section if relevant."""
}

# =============================
# MAIN ENDPOINT
# =============================
@app.route('/ai', methods=['POST'])
def ai_tool():
    if not GROQ_API_KEY:
        return jsonify({'error': 'Groq API key not configured'}), 500

    data = request.get_json()
    tool = data.get('tool')
    user_input = data.get('userInput') or data.get('prompt')

    if not tool or tool not in SYSTEM_PROMPTS:
        return jsonify({'error': 'Invalid or missing tool parameter'}), 400

    if not user_input:
        return jsonify({'error': 'Missing user input or prompt'}), 400

    system_prompt = SYSTEM_PROMPTS[tool]
    messages = [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_input}
    ]

    try:
        response = requests.post(
            GROQ_ENDPOINT,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {GROQ_API_KEY}'
            },
            json={
                'model': MODEL,
                'messages': messages,
                'temperature': 0.7,
                'max_tokens': 4096
            }
        )
        response.raise_for_status()
        data = response.json()
        reply = data['choices'][0]['message']['content']
        return jsonify({'reply': reply})
    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Groq API error: {str(e)}'}), 500
    except KeyError:
        return jsonify({'error': 'Unexpected response from Groq API'}), 500

# =============================
# HEALTH CHECK
# =============================
@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)

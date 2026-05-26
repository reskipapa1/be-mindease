from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import tensorflow as tf
import numpy as np
import pandas as pd
import joblib
from fastapi.middleware.cors import CORSMiddleware
import os
from groq import Groq

from dotenv import load_dotenv
load_dotenv()

# Setup Groq API
groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
GROQ_MODEL = "llama-3.3-70b-versatile"

app = FastAPI(title="MindEase AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. Load Model & Preprocessor
try:
    model = tf.keras.models.load_model('model_mindease_final.keras')
    print("Model Loaded Successfully!")
    
    preprocessor = joblib.load('preprocessor.pkl')
    encoders = preprocessor['encoders']
    scaler = preprocessor['scaler']
    feature_names = preprocessor['feature_names']
    print("Preprocessor Loaded Successfully!")
except Exception as e:
    print(f"Error Loading Model/Preprocessor: {e}")

# 2. Schema Input
class HealthData(BaseModel):
    features: dict

# 3. Nilai Default (Imputation) jika user tidak melengkapi data
DEFAULT_VALUES = {
    'age': 20,
    'gender': 'Female',
    'academic_year': 3,
    'study_hours_per_day': 4.0,
    'exam_pressure': 5.0,
    'academic_performance': 70.0,
    'stress_level': 5.0,
    'anxiety_score': 5.0,
    'depression_score': 5.0,
    'sleep_hours': 6.0,
    'physical_activity': 2.0,
    'social_support': 5.0,
    'screen_time': 6.0,
    'internet_usage': 6.0,
    'financial_stress': 5.0,
    'family_expectation': 5.0,
    'sleep_category': 'Cukup',
    'screen_time_category': 'Normal',
    'stress_category': 'Medium',
    'mental_risk_score': 3.0,
    'support_category': 'Low Support'
}

@app.get("/")
def home():
    return {"message": "MindEase AI API is Running", "status": "Ready"}

@app.post("/predict")
def predict(data: HealthData):
    input_dict = data.features
    
    # Isi nilai yang kosong (null) dengan DEFAULT_VALUES (Imputation)
    for col in feature_names:
        if col not in input_dict or input_dict[col] is None:
            input_dict[col] = DEFAULT_VALUES.get(col, 0)
    
    # 1. Konversi ke DataFrame dengan urutan kolom yang benar
    df_input = pd.DataFrame([input_dict], columns=feature_names)
    
    # 2. Apply LabelEncoder ke kolom kategorikal
    categorical_cols = list(encoders.keys())
    for col, le in encoders.items():
        if col in df_input.columns:
            known_classes = set(le.classes_)
            df_input[col] = df_input[col].apply(lambda x: str(x) if x in known_classes else le.classes_[0])
            df_input[col] = le.transform(df_input[col])
    
    # 2b. Pastikan semua kolom NUMERIK (non-kategorikal) bertipe float
    for col in feature_names:
        if col not in categorical_cols:
            try:
                df_input[col] = pd.to_numeric(df_input[col], errors='coerce').fillna(DEFAULT_VALUES.get(col, 0))
            except Exception:
                df_input[col] = DEFAULT_VALUES.get(col, 0)
            
    # 3. Apply MinMaxScaler
    X_scaled = scaler.transform(df_input)
    
    # Inference
    predictions = model.predict(X_scaled)
    
    # Parsing Results
    risk_probs = predictions[0][0]
    burnout_score = float(predictions[1][0][0])
    
    risk_idx = int(np.argmax(risk_probs))
    risk_labels = ['High', 'Low', 'Medium']
    risk_level = risk_labels[risk_idx]
    
    # Memanggil Groq Llama untuk rekomendasi yang lebih natural dan manusiawi
    try:
        level_map = {'High': 'tinggi', 'Medium': 'sedang', 'Low': 'rendah'}
        level_indo = level_map.get(risk_level, risk_level)
        prompt = (
            f"Kamu adalah konselor kesehatan mental yang hangat dan penuh empati. "
            f"Seorang mahasiswa baru saja selesai berbagi cerita dan sistem kami menilai "
            f"tingkat risiko mentalnya {level_indo} dengan skor burnout {burnout_score:.1f} dari 10. "
            f"Tulis 2-3 kalimat pesan personal yang terasa TULUS dan HANGAT untuknya. "
            f"Jangan sebut angka atau skor apapun. Jangan mulai dengan kata 'Berdasarkan' atau 'Analisis'. "
            f"Langsung sapa jiwanya seolah kamu sudah mendengar semua ceritanya. "
            f"Gunakan bahasa Indonesia yang santai, bukan formal."
        )
        
        chat_completion = groq_client.chat.completions.create(
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            model=GROQ_MODEL,
            temperature=0.7,
            max_tokens=256,
        )
        ai_recommendation = chat_completion.choices[0].message.content.strip()
    except Exception as e:
        ai_recommendation = "Apa pun yang sedang kamu hadapi, kamu sudah sangat berani dengan membagikannya. Jaga dirimu baik-baik ya, satu langkah kecil hari ini sudah cukup."
    
    return {
        "risk_level": risk_level,
        "burnout_score": round(burnout_score, 2),
        "probabilities": {
            "high": round(float(risk_probs[0]), 4),
            "low": round(float(risk_probs[1]), 4),
            "medium": round(float(risk_probs[2]), 4)
        },
        "genai_recommendation": ai_recommendation
    }

# Cara menjalankan: uvicorn app:app --reload
